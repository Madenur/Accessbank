import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const PORT = process.env.PORT || 4000;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ============================================
// DEPARTMENT DEFINITIONS
// ============================================

const DEPARTMENTS = {
  DIGITAL_BANKING: {
    name: 'DIGITAL_BANKING',
    label: 'Digital Banking',
    keywords: ['login', 'otp', 'mobile app', 'internet banking', 'mobile banking', 'app', 'access', 'technical', 'cannot access', 'blocked access', 'sms code', 'verification code', 'giriş', 'daxil', 'mobil app', 'internet', 'texniki', 'kod', 'sms', 'təsdiq'],
    description: 'mobil app, internet banking, login, OTP, app xətaları'
  },
  CARD_OPERATIONS: {
    name: 'CARD_OPERATIONS',
    label: 'Card Operations',
    keywords: ['card', 'payment failed', 'blocked card', 'lost card', 'stolen card', 'card payment', 'transaction failed', 'declined', 'card issue', 'kart', 'ödəniş', 'bloklanmış', 'itib', 'oğurlanmış', 'tranzaksiya', 'rədd', 'uğursuz'],
    description: 'kart ödənişləri, bloklanmış kartlar, kartla əlaqədar problemlər'
  },
  TRANSFERS_PAYMENTS: {
    name: 'TRANSFERS_PAYMENTS',
    label: 'Transfers & Payments',
    keywords: ['transfer', 'money deducted', 'payment', 'delayed payment', 'failed transfer', 'money not received', 'confirmation', 'pul', 'çıxılıb', 'tutulub', 'göndəriş', 'gecikmiş', 'dəyişdirilmə', 'pul alınmadı', 'təsdiqləmə'],
    description: 'uğursuz transferlər, gecikmiş ödənişlər, pul gəlməyən transferlər'
  },
  LOANS_APPLICATIONS: {
    name: 'LOANS_APPLICATIONS',
    label: 'Loans & Applications',
    keywords: ['loan', 'application', 'credit', 'application status', 'documents', 'repayment', 'loan approval', 'loan rejected', 'kredit', 'müraciət', 'sənəd', 'geri ödəmə', 'rədd', 'təsvib'],
    description: 'kredit müraciətləri, sənədlər, kredit şərtləri'
  },
  CUSTOMER_SERVICE: {
    name: 'CUSTOMER_SERVICE',
    label: 'Customer Service / Branch Operations',
    keywords: ['branch', 'service', 'staff', 'complaint', 'queue', 'experience', 'customer service', 'poor service', 'rude', 'filial', 'xidmət', 'işçi', 'şikayət', 'növbə', 'təcrübə', 'pis', 'kobud', 'qeydiyyat'],
    description: 'filial ziyarətləri, ümumi suallar, qeydiyyat, işçi şikayətləri'
  }
};

// ============================================
// SMART SECONDARY DEPARTMENT ROUTING RULES
// ============================================

const SECONDARY_ROUTING = {
  DIGITAL_BANKING: ['CUSTOMER_SERVICE'], // If login issue is complex, escalate to customer service
  CARD_OPERATIONS: ['TRANSFERS_PAYMENTS', 'CUSTOMER_SERVICE'], // Card payment might involve transfer, or customer service
  TRANSFERS_PAYMENTS: ['CARD_OPERATIONS', 'CUSTOMER_SERVICE'], // Transfer issue might involve card, or general service
  LOANS_APPLICATIONS: ['CUSTOMER_SERVICE'], // Loan issues can go to general service
  CUSTOMER_SERVICE: [] // General service handles everything
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function authenticateInternalKey(req, res) {
  const apiKey = req.headers['x-internal-api-key'];
  if (!apiKey || apiKey !== INTERNAL_API_KEY) {
    return {
      isValid: false,
      error: { status: 401, message: 'Unauthorized: Invalid API key' }
    };
  }
  return { isValid: true };
}

function checkFraudKeywords(text) {
  const fraudKeywords = ['fraud', 'unauthorized', 'hacked', 'scam', 'fırıldaq', 'icazəsiz', 'oğurlanmış'];
  return fraudKeywords.some(keyword => text.toLowerCase().includes(keyword));
}

function scoreText(text, keywords) {
  let score = 0;
  const lowerText = text.toLowerCase();
  for (const keyword of keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      score += 1;
    }
  }
  return score;
}

function findPrimaryDepartment(text) {
  let maxScore = 0;
  let primaryDept = 'CUSTOMER_SERVICE';

  for (const [deptKey, deptConfig] of Object.entries(DEPARTMENTS)) {
    const score = scoreText(text, deptConfig.keywords);
    if (score > maxScore) {
      maxScore = score;
      primaryDept = deptKey;
    }
  }

  return primaryDept;
}

function suggestSecondaryDepartment(primaryDept, text, priority) {
  // Never suggest secondary for CRITICAL
  if (priority === 'CRITICAL') {
    return null;
  }

  // Get secondary options for primary department
  const secondaryOptions = SECONDARY_ROUTING[primaryDept] || [];
  if (secondaryOptions.length === 0) {
    return null;
  }

  // Score each secondary option
  let bestSecondary = null;
  let maxScore = 0;

  for (const secondaryDept of secondaryOptions) {
    const score = scoreText(text, DEPARTMENTS[secondaryDept].keywords);
    if (score > maxScore && score > 0) {
      maxScore = score;
      bestSecondary = secondaryDept;
    }
  }

  return bestSecondary;
}

function getSystemPrompt() {
  return `Tapşırıq: Müştərinin göndərdiyi şikayət mətninə əsasən aşağıdakı informasiyanı sağla:

1. correctedText: Mətni Azərbaycan dilinə uyğun düzəlt (səhvləri qabaqlaş, kobud sözləri neytral et, məna saxla)
2. department: Şikayəti aşağıdakı departamentlərdən birinə təsnif et:
   - DIGITAL_BANKING: mobil app, internet banking, login, OTP, app xətaları
   - CARD_OPERATIONS: kart ödənişləri, bloklanmış kartlar, kartla əlaqədar problemlər
   - TRANSFERS_PAYMENTS: uğursuz transferlər, gecikmiş ödənişlər, pul gəlməyən transferlər
   - LOANS_APPLICATIONS: kredit müraciətləri, sənədlər, kredit şərtləri
   - CUSTOMER_SERVICE: filial ziyarətləri, ümumi suallar, qeydiyyat, işçi şikayətləri
3. priority: Prioriteti təyin et:
   - CRITICAL: itib verilmiş/oğurlanmış kart, qeyri-leyhalı əməliyyat, pul itkiləsi
   - HIGH: kart bloklanıb, OTP gəlmir, transfer pulu gəlməyib
   - MEDIUM: ödəniş gecikir, app yüklənmir, sənəd sorğusu
   - LOW: ümumi suallar, məlumat sorğuları
4. summary: Maksimum 15 sözlə bir cümlə xülasə (Azərbaycan dilində)
5. reasoning: Nə üçün bu departament və prioritet seçdiyini izah et (bir cümlə)
6. confidence: 0.0 ilə 1.0 arasında etibarlılıq dərəcəsi (məs: 0.91)

Qayda:
- YALNIZ aşağıdakı JSON formatında cavab ver, başqa heç nə əlavə etmə:
{
  "correctedText": "...",
  "department": "DIGITAL_BANKING",
  "priority": "HIGH",
  "summary": "...",
  "reasoning": "...",
  "confidence": 0.91
}
- Markdown, izah, başqa mətn yoxdur.
- JSON-u düzgün formatla.`;
}

// ============================================
// ROUTES
// ============================================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'accessbank-ai', 
    timestamp: new Date().toISOString() 
  });
});

/**
 * POST /analyze
 * Main endpoint: analyzes complaint and returns ticket intelligence
 */
app.post('/analyze', async (req, res) => {
  // Authenticate
  const auth = authenticateInternalKey(req, res);
  if (!auth.isValid) {
    return res.status(auth.error.status).json({ error: auth.error.message });
  }

  // Validate input
  const { complaintText } = req.body;
  if (!complaintText || typeof complaintText !== 'string') {
    return res.status(400).json({ error: 'complaintText is required (string)' });
  }

  if (complaintText.trim().length === 0) {
    return res.status(400).json({ error: 'complaintText cannot be empty' });
  }

  try {
    // Check for fraud keywords (override priority)
    const isFraud = checkFraudKeywords(complaintText);

    // Call OpenAI with Azerbaijani system prompt
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: getSystemPrompt(),
        },
        {
          role: 'user',
          content: `Müştəri şikayəti:\n"${complaintText}"`,
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(500).json({ error: 'No response from AI model' });
    }

    // Parse JSON response with fallback
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message);
      parsed = {
        correctedText: complaintText.trim(),
        department: 'CUSTOMER_SERVICE',
        priority: 'MEDIUM',
        summary: 'Müştəri şikayətinin təsviri lazımdır.',
        reasoning: 'AI modeli cavab verə bilmədi.',
        confidence: 0.5,
      };
    }

    // Override priority if fraud keywords detected
    if (isFraud) {
      parsed.priority = 'CRITICAL';
      parsed.reasoning = 'Təhlükəlilik anahtar sözü aşkarlandı. Fərdi önerge olaraq CRITICAL prioriteti təyin edildi.';
    }

    // Ensure confidence is a number between 0 and 1
    if (typeof parsed.confidence !== 'number') {
      parsed.confidence = 0.75;
    }
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

    // Smart secondary department suggestion
    const secondaryDept = suggestSecondaryDepartment(parsed.department, complaintText, parsed.priority);
    let secondaryReason = null;
    
    if (secondaryDept) {
      const primaryLabel = DEPARTMENTS[parsed.department].label;
      const secondaryLabel = DEPARTMENTS[secondaryDept].label;
      secondaryReason = `${primaryLabel} yüklü olduqda və ya problem ${secondaryLabel} tərəfindən də həll edilə bilərsə bu departamenta yönləndir.`;
    }

    // Return complete response
    const result = {
      correctedText: parsed.correctedText,
      department: parsed.department,
      priority: parsed.priority,
      summary: parsed.summary,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      secondaryDepartment: secondaryDept,
      secondaryReason: secondaryReason
    };

    return res.json(result);

  } catch (err) {
    console.error('Error analyzing complaint:', err.message);

    if (err.message.includes('API') || err.message.includes('authentication')) {
      return res.status(500).json({ error: 'AI service error. Check your OpenAI API key.' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`\n==============================================`);
  console.log(`AccessBank AI Service`);
  console.log(`==============================================`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: GET http://localhost:${PORT}/health`);
  console.log(`Analyze endpoint: POST http://localhost:${PORT}/analyze`);
  console.log(`==============================================\n`);
});
