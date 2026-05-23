import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check internal API key authentication
 */
function authenticateInternalKey(req, res) {
  const key = req.header('x-internal-api-key');
  if (!process.env.INTERNAL_API_KEY) {
    return {
      isValid: false,
      error: { status: 500, message: 'INTERNAL_API_KEY is not configured' },
    };
  }
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return {
      isValid: false,
      error: { status: 401, message: 'Unauthorized: Invalid or missing API key' },
    };
  }
  return { isValid: true };
}

/**
 * Fraud/security keyword override
 * Returns CRITICAL if complaint contains sensitive keywords
 */
function checkFraudKeywords(text) {
  const fraudKeywords = [
    'unauthorized',
    'fraud',
    'stolen',
    'lost card',
    'hack',
    'hacked',
    'not me',
    'didnt authorize',
    'didn\'t authorize',
    'someone else',
    'suspicious',
    'scam',
    'blocked account',
    'qeyri-leyhalı',
    'oğurlanıb',
    'itib vermişəm',
    'mənim deyil',
    'fırıldaqçılıq',
  ];
  const lowerText = text.toLowerCase();
  return fraudKeywords.some(keyword => lowerText.includes(keyword));
}

/**
 * System prompt in Azerbaijani for strict JSON output
 */
function getSystemPrompt() {
  return `Sən AccessBank üçün müştəri şikayətlərini analiz edən AI asistantsan.

Tapşırıq: Müştərinin göndərdiyi şikayət mətninə əsasən aşağıdakı informasiyanı sağla:

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
7. secondaryDepartment: Əgər birincil departament yüklü deyilsə, alternativ departament (null ola bilər)
8. secondaryReason: Alternativ departament seçilmişsə səbəbi (null ola bilər)

Qayda:
- YALNIZ aşağıdakı JSON formatında cavab ver, başqa heç nə əlavə etmə:
{
  "correctedText": "...",
  "department": "...",
  "priority": "...",
  "summary": "...",
  "reasoning": "...",
  "confidence": 0.0,
  "secondaryDepartment": null,
  "secondaryReason": null
}
- Markdown, izah, başqa mətn yoxdur.
- JSON-u düzgün formatla.`;
}

/**
 * Overload logic: suggest secondary department if primary is overloaded
 */
function calculateSecondaryDepartment(
  primaryDept,
  priority,
  departmentLoads
) {
  // Never reroute CRITICAL or HIGH priority
  if (priority === 'CRITICAL' || priority === 'HIGH') {
    return { secondaryDepartment: null, secondaryReason: null };
  }

  if (!departmentLoads || !departmentLoads[primaryDept]) {
    return { secondaryDepartment: null, secondaryReason: null };
  }

  const primaryLoad = departmentLoads[primaryDept];
  const allDepts = Object.entries(departmentLoads)
    .filter(([dept]) => dept !== primaryDept)
    .sort(([, a], [, b]) => a - b);

  if (allDepts.length === 0) {
    return { secondaryDepartment: null, secondaryReason: null };
  }

  const [secondaryDept, secondaryLoad] = allDepts[0];

  // Suggest secondary only if: primary load >= 2x secondary load AND difference >= 10
  if (primaryLoad >= secondaryLoad * 2 && primaryLoad - secondaryLoad >= 10) {
    return {
      secondaryDepartment: secondaryDept,
      secondaryReason: `${primaryDept} yüklü (${primaryLoad} açıq bilet vs ${secondaryLoad} açıq bilet). ${secondaryDept} daha az yüklüdür.`,
    };
  }

  return { secondaryDepartment: null, secondaryReason: null };
}

// ============================================
// ROUTES
// ============================================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'accessbank-ai', timestamp: new Date().toISOString() });
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
  const { complaintText, departmentLoads } = req.body;
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
      temperature: 0.3, // Low temperature for consistent output
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
      // Fallback: return safe default if JSON parsing fails
      console.error('JSON parse error:', parseErr.message);
      parsed = {
        correctedText: complaintText.trim(),
        department: 'CUSTOMER_SERVICE',
        priority: 'MEDIUM',
        summary: 'Müştəri şikayətinin təsviri lazımdır.',
        reasoning: 'AI modeli cavab verə bilmədi.',
        confidence: 0.5,
        secondaryDepartment: null,
        secondaryReason: null,
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

    // Calculate secondary department suggestion
    const { secondaryDepartment, secondaryReason } = calculateSecondaryDepartment(
      parsed.department,
      parsed.priority,
      departmentLoads
    );
    parsed.secondaryDepartment = secondaryDepartment;
    parsed.secondaryReason = secondaryReason;

    return res.json(parsed);
  } catch (err) {
    console.error('Error analyzing complaint:', err.message);

    // Don't expose internal errors
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
