const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

let isOllamaAvailable = null;

export async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json();
      isOllamaAvailable = (data.models && data.models.length > 0);
      return { available: isOllamaAvailable, models: data.models?.map(m => m.name) || [] };
    }
  } catch (e) {
    isOllamaAvailable = false;
  }
  return { available: false, models: [] };
}

export async function analyzeConversation(transcriptEntries = []) {
  if (!transcriptEntries || transcriptEntries.length === 0) {
    return {
      sentiment: 'Neutral',
      intent: 'Awaiting Speech',
      urgency: 'LOW',
      keywords: [],
      topics: ['Call Initiated'],
      questions: [],
      concerns: [],
      recommendations: ['Greet caller professionally and listen for baseline inquiry.'],
      summary: 'Call connected. Awaiting initial statements from caller.'
    };
  }

  const fullText = transcriptEntries.map(e => `${e.speaker}: ${e.text}`).join('\n');
  const callerText = transcriptEntries.filter(e => e.speaker === 'caller').map(e => e.text).join(' ');

  // Try Ollama first if available
  if (isOllamaAvailable) {
    try {
      const prompt = `You are a real-time call center and emergency intelligence AI.
Analyze this live conversation and output ONLY valid JSON matching this schema:
{
  "sentiment": "Positive" | "Neutral" | "Anxious" | "Frustrated" | "Distressed",
  "intent": "<string>",
  "urgency": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "keywords": ["<str>", "<str>"],
  "topics": ["<str>", "<str>"],
  "questions": ["<str>"],
  "concerns": ["<str>"],
  "recommendations": ["<str>", "<str>"],
  "summary": "<1-2 sentence summary>"
}

Transcript:
${fullText}
`;
      const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          format: 'json',
          stream: false
        }),
        signal: AbortSignal.timeout(3000)
      });

      if (res.ok) {
        const data = await res.json();
        const parsed = JSON.parse(data.response);
        if (parsed.sentiment && parsed.intent) {
          return parsed;
        }
      }
    } catch (err) {
      // Fall through to local heuristic engine
    }
  }

  // Robust Local Offline NLP Engine
  return localHeuristicAnalysis(callerText, transcriptEntries);
}

function localHeuristicAnalysis(text, entries) {
  const lower = text.toLowerCase();
  const words = lower.match(/\b[a-z0-9_-]{3,}\b/g) || [];

  // 1. Keyword extraction & counts
  const stopwords = new Set([
    'the','and','for','that','this','with','have','from','you','your','what','when','where','how','why',
    'can','could','would','should','just','like','about','there','here','please','hello','yeah','yes','okay'
  ]);
  const freq = {};
  for (const w of words) {
    if (!stopwords.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  const topKeywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k);

  // 2. Distress & Covert Duress Pattern (Pizza, pepperoni, deliver, danger, help, hostage)
  const isPizzaCovert = /\b(pizza|pepperoni|crust|slice)\b/i.test(lower);
  const pizzaMatches = (lower.match(/\bpizza\b/g) || []).length;
  const isEmergency = /\b(help|danger|police|hurt|trapped|stuck|weapon|attack|fire|ambulance)\b/i.test(lower);
  const isFrustrated = /\b(angry|cancel|broken|terrible|awful|unacceptable|lawyer|sue|waste|ridiculous)\b/i.test(lower);
  const isTechnical = /\b(error|bug|crash|down|login|password|offline|server|connection|reset)\b/i.test(lower);
  const isBilling = /\b(bill|charge|refund|payment|subscription|invoice|credit|cost|price|money)\b/i.test(lower);

  // 3. Urgency scoring
  let urgency = 'LOW';
  if (pizzaMatches >= 2 || (isPizzaCovert && lower.includes('apartment')) || isEmergency) {
    urgency = 'CRITICAL';
  } else if (pizzaMatches === 1 || isFrustrated || lower.includes('urgent') || lower.includes('asap')) {
    urgency = 'HIGH';
  } else if (isBilling || isTechnical || entries.length > 6) {
    urgency = 'MEDIUM';
  }

  // 4. Sentiment
  let sentiment = 'Neutral';
  if (isEmergency || pizzaMatches >= 2) {
    sentiment = 'Distressed';
  } else if (isFrustrated) {
    sentiment = 'Frustrated';
  } else if (pizzaMatches === 1 || lower.includes('nervous') || lower.includes('cannot speak')) {
    sentiment = 'Anxious';
  } else if (lower.includes('thank') || lower.includes('great') || lower.includes('appreciate')) {
    sentiment = 'Positive';
  }

  // 5. Intent
  let intent = 'General Customer Inquiry';
  if (pizzaMatches >= 2) {
    intent = 'Covert Duress / Disguised Emergency Assistance';
  } else if (pizzaMatches === 1) {
    intent = 'Disguised Food Order / Emergency Screening';
  } else if (isEmergency) {
    intent = 'Urgent Incident Report';
  } else if (isTechnical) {
    intent = 'Technical Support / Service Outage';
  } else if (isBilling) {
    intent = 'Billing & Payment Resolution';
  } else if (lower.includes('status') || lower.includes('order')) {
    intent = 'Order / Case Status Check';
  }

  // 6. Topics
  const topics = [];
  if (isPizzaCovert) topics.push('Covert Script Detection', 'Civilian Food Order');
  if (lower.includes('apartment') || lower.includes('floor') || lower.includes('street') || lower.includes('road')) topics.push('Location Coordinates');
  if (isTechnical) topics.push('Software/System Diagnostics');
  if (isBilling) topics.push('Financial Inquiry');
  if (topics.length === 0) topics.push('Customer Communication', 'Inquiry Clarification');

  // 7. Questions & Concerns
  const questions = [];
  const concerns = [];
  for (const e of entries) {
    if (e.text.includes('?')) {
      questions.push(e.text.trim());
    }
  }
  if (pizzaMatches >= 1) concerns.push('Caller cannot speak directly about danger');
  if (lower.includes('cannot speak') || lower.includes('two people') || lower.includes('here')) concerns.push('Potential hostile actor present nearby');
  if (isFrustrated) concerns.push('Customer dissatisfaction and churn risk');

  // 8. Actionable recommendations
  const recommendations = [];
  if (pizzaMatches >= 2) {
    recommendations.push(
      'DO NOT HANG UP. Maintain line continuously.',
      'Switch strictly to closed Yes/No questions to ensure caller safety.',
      'Extract floor number, apartment digits, and cross-street without alerting bystanders.',
      'Stage discrete tactical intervention with silent sirens.'
    );
  } else if (pizzaMatches === 1) {
    recommendations.push(
      'Acknowledge calmly: "Are you unable to speak freely right now?"',
      'Listen for ambient background voices or forced calm tone.',
      'Prepare closed protocol if repetition occurs.'
    );
  } else if (isFrustrated) {
    recommendations.push(
      'Acknowledge customer frustration with empathetic de-escalation tone.',
      'Offer immediate expedited review and direct escalation.'
    );
  } else {
    recommendations.push(
      'Confirm specific account details and clarify primary goal.',
      'Provide structured follow-up resolution and confirm caller satisfaction.'
    );
  }

  // 9. Summary
  let summary = 'Conversation ongoing between caller and operator.';
  if (pizzaMatches >= 2) {
    summary = `Caller repeated food order (${pizzaMatches}x) indicating potential covert duress. Operator advised to use closed questioning.`;
  } else if (isEmergency) {
    summary = 'Caller reported urgent emergency incident requiring immediate intervention.';
  } else if (isTechnical) {
    summary = 'Caller reported technical difficulty requiring system diagnosis.';
  } else if (isBilling) {
    summary = 'Caller inquired regarding billing and transaction details.';
  }

  return {
    sentiment,
    intent,
    urgency,
    keywords: topKeywords,
    topics,
    questions: questions.slice(-3),
    concerns: concerns.slice(-3),
    recommendations,
    summary
  };
}

