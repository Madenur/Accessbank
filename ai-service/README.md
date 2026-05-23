# AccessBank AI Microservice

Standalone Express.js microservice that analyzes raw Azerbaijani customer complaints and returns complete ticket intelligence (text refinement, department classification, priority detection, summary generation, confidence scoring, and secondary department suggestion).

## Features

✅ **Text Refinement** — Corrects Azerbaijani spelling/grammar, removes insults, keeps meaning
✅ **Department Classification** — Routes to: DIGITAL_BANKING, CARD_OPERATIONS, TRANSFERS_PAYMENTS, LOANS_APPLICATIONS, CUSTOMER_SERVICE
✅ **Priority Detection** — Assigns: LOW, MEDIUM, HIGH, CRITICAL
✅ **Summary Generation** — Creates one-sentence summary (≤15 words) in Azerbaijani
✅ **Confidence Scoring** — Returns 0.0–1.0 confidence in classification
✅ **Secondary Department Suggestion** — Recommends alternative department if primary is overloaded
✅ **Fraud Keyword Override** — Automatically escalates to CRITICAL for security threats
✅ **API Key Authentication** — Internal security with `x-internal-api-key` header

## Setup

### 1. Install dependencies

```bash
cd ai-service
npm install
```

### 2. Configure environment

Create `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Edit `.env` and add your keys:

```env
OPENAI_API_KEY=your_openai_api_key_here
INTERNAL_API_KEY=shared-secret-with-your-backend
PORT=4000
```

### 3. Get OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Create new API key
3. Copy and paste into `.env`

### 4. Start the server

```bash
npm start
```

You should see:

```
==============================================
AccessBank AI Service
==============================================
Server running on http://localhost:4000
Health check: GET http://localhost:4000/health
Analyze endpoint: POST http://localhost:4000/analyze
==============================================
```

## API Usage

### Health Check

```bash
curl http://localhost:4000/health
```

Response:

```json
{
  "status": "ok",
  "service": "accessbank-ai",
  "timestamp": "2025-05-23T10:30:00.000Z"
}
```

### Analyze Complaint

```bash
curl -X POST http://localhost:4000/analyze \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: shared-secret-with-your-backend" \
  -d '{
    "complaintText": "kartimdan iki defe pul cekilib bravo marketde hecne bilmirəm",
    "departmentLoads": {
      "DIGITAL_BANKING": 10,
      "CARD_OPERATIONS": 50,
      "TRANSFERS_PAYMENTS": 22,
      "LOANS_APPLICATIONS": 6,
      "CUSTOMER_SERVICE": 12
    }
  }'
```

Response:

```json
{
  "correctedText": "Bravo Marketdə kartımdan iki dəfə ödəniş tutulub.",
  "department": "CARD_OPERATIONS",
  "priority": "HIGH",
  "summary": "Kartdan qeyri-müəyyən məbləğdə iki dəfə ödəniş tutulub.",
  "reasoning": "Kartla bağlı ödəniş problemləri CARD_OPERATIONS tərəfindən idarə olunur.",
  "confidence": 0.91,
  "secondaryDepartment": "CUSTOMER_SERVICE",
  "secondaryReason": "CARD_OPERATIONS yüklü (50 açıq bilet vs 12 açıq bilet). CUSTOMER_SERVICE daha az yüklüdür."
}
```

## Test Examples

### Test 1: Card Charged Twice

```bash
curl -X POST http://localhost:4000/analyze \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: shared-secret-with-your-backend" \
  -d '{
    "complaintText": "kartimdan iki defe pul cekilib bravo marketde hecne bilmirəm"
  }'
```

Expected: `CARD_OPERATIONS`, `HIGH`

### Test 2: Unauthorized Transaction (Fraud Keyword)

```bash
curl -X POST http://localhost:4000/analyze \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: shared-secret-with-your-backend" \
  -d '{
    "complaintText": "menim olmayan 5000 manat unauthorized olaraq cəkilib"
  }'
```

Expected: Auto-escalated to `CRITICAL` (fraud keyword detected)

### Test 3: OTP Not Working

```bash
curl -X POST http://localhost:4000/analyze \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: shared-secret-with-your-backend" \
  -d '{
    "complaintText": "OTP gəlmir, mobil appdan login olmaq mümkün deyil"
  }'
```

Expected: `DIGITAL_BANKING`, `HIGH`

### Test 4: Transfer Not Received

```bash
curl -X POST http://localhost:4000/analyze \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: shared-secret-with-your-backend" \
  -d '{
    "complaintText": "transferim göndərdim amma mənə gəlmədi, pul hesabımdan cəkilib"
  }'
```

Expected: `TRANSFERS_PAYMENTS`, `CRITICAL`

### Test 5: Loan Status Question

```bash
curl -X POST http://localhost:4000/analyze \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: shared-secret-with-your-backend" \
  -d '{
    "complaintText": "menim kredit müraciəti harada?"
  }'
```

Expected: `LOANS_APPLICATIONS`, `MEDIUM`

## Request Schema

```json
{
  "complaintText": "string (required, 1-2000 chars)",
  "departmentLoads": {
    "DIGITAL_BANKING": "number (optional)",
    "CARD_OPERATIONS": "number (optional)",
    "TRANSFERS_PAYMENTS": "number (optional)",
    "LOANS_APPLICATIONS": "number (optional)",
    "CUSTOMER_SERVICE": "number (optional)"
  }
}
```

## Response Schema

```json
{
  "correctedText": "string - professional Azerbaijani version",
  "department": "string - one of 5 departments",
  "priority": "string - LOW | MEDIUM | HIGH | CRITICAL",
  "summary": "string - max 15 words in Azerbaijani",
  "reasoning": "string - one sentence explanation",
  "confidence": "number - 0.0 to 1.0",
  "secondaryDepartment": "string | null - alternative if overloaded",
  "secondaryReason": "string | null - why secondary is suggested"
}
```

## Deployment

### Deploy to Railway

1. Push to GitHub
2. Connect GitHub repo to Railway
3. Set environment variables in Railway dashboard:
   - `OPENAI_API_KEY`
   - `INTERNAL_API_KEY`
   - `PORT`
4. Deploy
5. Copy railway URL and give to your friend's backend

### Deploy to Render

1. Push to GitHub
2. Connect GitHub repo to Render
3. Create new Web Service pointing to `ai-service` directory
4. Set environment variables
5. Deploy
6. Copy render URL and give to your friend's backend

## Integration with Next.js Backend

Your friend's backend calls this API:

```typescript
const aiResp = await fetch(process.env.AI_SERVICE_URL + "/analyze", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-internal-api-key": process.env.AI_SERVICE_KEY!,
  },
  body: JSON.stringify({ 
    complaintText,
    departmentLoads: {
      DIGITAL_BANKING: counts.digitalBanking,
      CARD_OPERATIONS: counts.cardOperations,
      TRANSFERS_PAYMENTS: counts.transfers,
      LOANS_APPLICATIONS: counts.loans,
      CUSTOMER_SERVICE: counts.customerService,
    }
  }),
});

const ai = await aiResp.json();
```

Then save to database:

```typescript
await prisma.ticket.create({
  data: {
    rawText: complaintText,
    correctedText: ai.correctedText,
    aiSummary: ai.summary,
    aiReasoning: ai.reasoning,
    department: ai.department,
    priority: ai.priority,
    secondaryDepartment: ai.secondaryDepartment,
    secondaryReason: ai.secondaryReason,
  },
});
```

## Troubleshooting

### "INTERNAL_API_KEY is not configured"

Make sure `.env` file has `INTERNAL_API_KEY=...` and server is restarted.

### "Unauthorized: Invalid or missing API key"

Make sure request includes header: `x-internal-api-key: <value from .env>`

### "AI service error. Check your OpenAI API key."

1. Verify OpenAI API key is correct
2. Check your OpenAI account has available balance/quota
3. Ensure key is not expired

### JSON parse errors

The service has a fallback, but if you see parse errors in logs, the model might be returning invalid JSON. Try restarting and testing again.

## Support

For issues, check:

1. Server logs: `npm start` output
2. OpenAI status: https://status.openai.com
3. Environment variables: `cat .env` (don't share keys!)
4. API key permissions: https://platform.openai.com/account/api-keys
