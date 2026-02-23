// netlify/functions/elemental-analysis.js
// ─────────────────────────────────────────────────────────────
// Receives questionnaire submission → classifies scores →
// calls Claude API for personalised overview → assembles
// full email from template blocks → sends via Resend
// ─────────────────────────────────────────────────────────────

// ── Rate limiting (in-memory, resets on cold start) ──
const rateLimitMap = new Map();
const RATE_LIMIT = 5;         // max submissions
const RATE_WINDOW = 3600000;  // per hour (ms)

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - record.start > RATE_WINDOW) {
    record.count = 1;
    record.start = now;
  } else {
    record.count++;
  }
  rateLimitMap.set(ip, record);
  return record.count > RATE_LIMIT;
}

// ── Score classification ──
function classify(mean) {
  const n = parseFloat(mean);
  if (n < 2.5) return "Low";
  if (n <= 3.8) return "Medium";
  return "High";
}

function findStrongestAndWeakest(means) {
  const elements = Object.entries(means);
  elements.sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
  return {
    strongest: { name: capitalise(elements[0][0]), score: elements[0][1] },
    weakest:   { name: capitalise(elements[elements.length - 1][0]), score: elements[elements.length - 1][1] }
  };
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── System prompt for Claude ──
const SYSTEM_PROMPT = `You are the voice of Elemental Discovery, a transformational framework built around five inner elements: Fire (purpose, drive, expression, courage), Water (emotion, body, intuition, fluidity), Air (mind, clarity, perspective, communication), Earth (stability, discipline, structure, groundedness), and Spirit (meaning, purpose, connection, transcendence).

Your tone is:
- Grounded and psychologically mature
- Reflective, not diagnostic
- Warm but direct — no fluff, no hype
- Never mystical, never corporate, never sales-driven
- Second person ("you"), as if speaking to one person with care

The elemental balance is not a fixed identity. It reflects where someone is right now. Elements are not good or bad — they are dimensions that can be underdeveloped or overdeveloped.

You never use the words: quiz, test, score (use "reflection" or "analysis" instead), fix (use "harmonise" or "develop"), broken, toxic, or healed.

You always write in British English spelling (harmonise, recognise, colour, etc.).`;

// ── Claude API call ──
async function generatePersonalisedSections(scores, strongest, weakest) {
  const prompt = `A participant just completed the Elemental Balance Analysis. Here are their element means (scale 1-5):

Fire: ${scores.fire} (${classify(scores.fire)})
Water: ${scores.water} (${classify(scores.water)})
Air: ${scores.air} (${classify(scores.air)})
Earth: ${scores.earth} (${classify(scores.earth)})
Spirit: ${scores.spirit} (${classify(scores.spirit)})

Strongest element: ${strongest.name} (${strongest.score})
Weakest element: ${weakest.name} (${weakest.score})

Write exactly two sections:

SECTION 1 — OVERVIEW (3 sentences):
Sentence 1: What leading with ${strongest.name} suggests about how they orient in the world.
Sentence 2: How their lowest element, ${weakest.name}, may create tension or blind spots.
Sentence 3: A short summary of the core dynamic this creates — name the pattern in plain language.

SECTION 2 — CORE DYNAMIC (1 paragraph, 3-5 sentences):
Based on the combination of their strongest and weakest elements, write a reflective paragraph about what this pattern tends to look like in daily life. End with a sentence starting "The deeper invitation is..." that points toward growth.

Format your response as JSON:
{"overview": "...", "coreDynamic": "..."}

Return ONLY the JSON, no other text.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || "";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── Email template blocks ──
const ELEMENT_BLOCKS = {
  fire: {
    Low: {
      body: `When Fire is low, it often shows up as reduced drive, hesitation, or difficulty taking decisive action. You may know what you want but find yourself unable to move toward it. There can be a sense of flatness — suppressed anger, suppressed desire, or a muted relationship with your own vitality.

Low Fire does not mean weakness. It often means the flame has been dampened — by environment, by habit, or by an extended period of playing small. The invitation is not to force intensity, but to rekindle contact with what genuinely moves you.`,
      advice: [
        "Short daily physical activation — even 10 minutes of movement that raises your heart rate",
        "Practice setting one clear boundary per week",
        "Take one bold or uncomfortable action each day, however small",
        "Reconnect with competition, challenge, or anything that stirs your edge",
        "Reduce passivity: less scrolling, less spectating, more doing"
      ]
    },
    Medium: {
      body: `Your Fire is present but inconsistent. You likely act with energy and conviction when inspiration strikes, but struggle to sustain that drive when motivation dips. There may be periods of great clarity followed by withdrawal or hesitation.

This is a common and workable pattern. The key is not more intensity, but more consistency — learning to act even when the spark isn't fully lit.`,
      advice: [
        "Set structured goals with clear timelines — not just intentions",
        "Weekly discomfort practice: cold exposure, difficult conversations, physical challenge",
        "Sharpen direct communication — say what you mean more often",
        "Track your follow-through honestly over 30 days",
        "Notice when you dim yourself to avoid conflict, and choose differently"
      ]
    },
    High: {
      body: `Strong Fire brings drive, courage, magnetism, and the ability to take decisive action. You likely move through life with visible intensity and purpose. People may look to you for leadership, direction, or energy.

The shadow side of high Fire is burnout, impatience, dominance, or an inability to rest. When Fire runs unchecked, it can consume what it was meant to fuel. The invitation is not to suppress your fire, but to channel it wisely.`,
      advice: [
        "Integrate cooling practices: breathwork, time in nature, intentional stillness",
        "Practice listening fully before responding — especially under pressure",
        "Channel intensity into long-term creation, not just short-term action",
        "Soften the need to control outcomes",
        "Ask: am I acting from clarity, or from restlessness?"
      ]
    }
  },
  water: {
    Low: {
      body: `Low Water often manifests as physical tension, emotional rigidity, or a sense of being cut off from your own feeling life. You may hold stress in your body without realising it, or find it difficult to access vulnerability, grief, or tenderness.

Water is the element of flow. When it's depleted, life can feel dry, rigid, or overly controlled. The invitation is to soften — to let yourself feel what is actually there.`,
      advice: [
        "Daily body check-in: where are you holding tension right now?",
        "Gentle movement practices: swimming, stretching, yoga, or walking in nature",
        "Allow emotions to surface without immediately solving or suppressing them",
        "Spend time near water — baths, rivers, the sea",
        "Journaling focused on \"What am I actually feeling?\""
      ]
    },
    Medium: {
      body: `Your Water is functional but not yet flowing freely. You can access emotion and body awareness at times, but there may be areas where you still hold back, tighten up, or disconnect. You might notice that certain emotions move through you easily while others get stuck.

This is a place of potential. The foundation is there — it simply needs more permission and practice.`,
      advice: [
        "Deepen your body awareness through consistent somatic practice",
        "Notice which emotions you welcome and which ones you resist",
        "Practice staying with discomfort a few seconds longer before reacting",
        "Create regular space for unstructured feeling: music, art, nature",
        "Explore what softness means to you — and where you might allow more of it"
      ]
    },
    High: {
      body: `Strong Water gives you deep emotional intelligence, embodied awareness, and a natural capacity for empathy and connection. You likely feel things intensely and may have a rich inner life.

The risk of high Water without balance is overwhelm, emotional flooding, poor boundaries, or absorbing others' emotions. When Water runs unchecked, it can drown what it was meant to nourish.`,
      advice: [
        "Strengthen boundaries: not everything you feel is yours to carry",
        "Ground your emotional life with clear structure and routine (Earth element)",
        "Learn to differentiate between your feelings and others'",
        "Balance receptivity with assertive action (Fire element)",
        "Ask: am I feeling deeply, or am I being swept away?"
      ]
    }
  },
  air: {
    Low: {
      body: `Low Air can show up as mental fog, rigid thinking, difficulty seeing other perspectives, or a tendency to react before reflecting. You may feel mentally stuck — trapped in repetitive thought patterns or unable to zoom out from your situation.

Air governs spaciousness of mind. When it's low, the inner landscape can feel narrow and cluttered. The invitation is to create more room — between stimulus and response, between thought and belief.`,
      advice: [
        "Daily mindfulness or meditation practice — even 5 minutes",
        "Seek perspectives that challenge your current thinking",
        "Practice pausing before responding, especially in stressful moments",
        "Read, learn, or engage with ideas outside your usual domain",
        "Spend time in open spaces — physically and mentally"
      ]
    },
    Medium: {
      body: `Your Air element is active but not fully consistent. You can think clearly and hold perspective when conditions are right, but under stress you may revert to overthinking, mental loops, or narrow focus. There is capacity here that deepens with attention.`,
      advice: [
        "Build a consistent reflective practice — journaling, meditation, or contemplation",
        "Notice when your thinking becomes rigid and consciously widen the frame",
        "Practice expressing your thoughts clearly and directly",
        "When overwhelmed, write it down — externalise the mental load",
        "Balance thinking with embodied action to avoid analysis paralysis"
      ]
    },
    High: {
      body: `Strong Air gives you clarity of thought, creative perspective, and the ability to hold complexity. You likely see patterns others miss, communicate with precision, and bring mental agility to challenges.

The shadow of high Air is overthinking, detachment, intellectual arrogance, or living too much in the mind. When Air dominates, you may understand everything conceptually but struggle to feel it, embody it, or act on it.`,
      advice: [
        "Ground your insights in physical action and embodied practice",
        "Notice when thinking replaces feeling — drop from the head into the body",
        "Simplify: not every thought needs to be followed",
        "Practice being present without analysing",
        "Ask: am I seeing clearly, or just thinking cleverly?"
      ]
    }
  },
  earth: {
    Low: {
      body: `Low Earth often shows up as inconsistency, difficulty following through, lack of routine, or a sense of being ungrounded. You may have big visions but struggle to translate them into sustained action. Finances, health habits, or daily structure may feel chaotic or neglected.

Earth is the element of foundation. Without it, everything else remains potential. The invitation is not to become rigid, but to build the container that holds your growth.`,
      advice: [
        "Establish one non-negotiable daily routine and protect it",
        "Focus on follow-through: finish what you start before beginning something new",
        "Simplify your commitments — depth over breadth",
        "Spend time in nature, with your feet on the ground",
        "Address practical foundations: finances, health, living environment"
      ]
    },
    Medium: {
      body: `Your Earth is present but not yet fully solid. You can sustain effort when motivated, but consistency may waver under pressure or boredom. You have structure in some areas of life but not others. The pattern is functional, but there is room to build something more reliable.`,
      advice: [
        "Audit your routines: where is structure strong, and where does it break down?",
        "Set weekly goals that are specific and measurable",
        "Practice patience with slow, incremental progress",
        "Build resilience by staying with difficult tasks longer than comfortable",
        "Notice the gap between intention and action — close it deliberately"
      ]
    },
    High: {
      body: `Strong Earth gives you discipline, reliability, persistence, and a grounded presence. You likely follow through on commitments, maintain consistent routines, and create stability for yourself and others.

The shadow of high Earth is rigidity, resistance to change, over-control, or becoming so rooted that you cannot adapt. When Earth dominates, growth can stall because the structure that supports you also confines you.`,
      advice: [
        "Introduce more spontaneity and flexibility into your routines",
        "Practice letting go of control in small, deliberate ways",
        "Allow space for emotional expression and creative risk (Fire and Water)",
        "Question whether your discipline serves growth or avoids discomfort",
        "Ask: am I building, or am I just holding on?"
      ]
    }
  },
  spirit: {
    Low: {
      body: `Low Spirit often manifests as a feeling of disconnection, meaninglessness, or existential flatness. Life may feel functional but hollow — like going through the motions without deeper purpose.

Spirit is the element of meaning. When it's low, the question is not "What should I do?" but "What does any of it mean?" The invitation is not to force belief, but to open toward connection — with others, with nature, with purpose.`,
      advice: [
        "Explore what gives you a sense of meaning — beyond achievement or productivity",
        "Seek community or belonging: isolation drains Spirit",
        "Spend time in nature, ritual, or practices that connect you to something larger",
        "Reflect on your values — are you living in alignment with them?",
        "Allow yourself to sit with the big questions without needing answers"
      ]
    },
    Medium: {
      body: `Your Spirit is present but perhaps inconsistent. You have moments of deep meaning and connection, but they are not yet the baseline. Under pressure, meaning can fade and isolation may return. There is a foundation of purpose here that can be strengthened.`,
      advice: [
        "Develop a consistent practice that nourishes your sense of meaning",
        "Deepen your connection to community, nature, or creative expression",
        "Revisit your core values and notice where daily life drifts from them",
        "Create rituals — even small ones — that mark transitions and intentions",
        "Practice gratitude not as a technique, but as genuine attention to what is good"
      ]
    },
    High: {
      body: `Strong Spirit gives you a deep sense of meaning, connection, and coherence. You likely feel aligned with your values, connected to something beyond yourself, and able to hold suffering within a larger frame.

The shadow of high Spirit without grounding is dissociation, spiritual bypassing, or avoidance of practical reality. When Spirit dominates, you may float above life rather than fully engaging with it.`,
      advice: [
        "Ground your spiritual life in embodied action and practical contribution",
        "Be honest about what you may be avoiding through spiritual framing",
        "Stay connected to the messy, human parts of life — not just the transcendent",
        "Ensure your sense of meaning translates into tangible impact",
        "Ask: am I truly connected, or am I floating?"
      ]
    }
  }
};

// ── Build HTML email ──
function buildEmail(name, scores, strongest, weakest, personalised) {
  const elementOrder = ["fire", "water", "air", "earth", "spirit"];
  const elementLabels = { fire: "Fire", water: "Water", air: "Air", earth: "Earth", spirit: "Spirit" };
  const elementSubtitles = {
    fire: "Purpose · Drive · Expression · Courage",
    water: "Emotion · Body · Intuition · Fluidity",
    air: "Mind · Clarity · Perspective · Communication",
    earth: "Stability · Discipline · Structure · Groundedness",
    spirit: "Meaning · Purpose · Connection · Transcendence"
  };
  const elementColors = {
    fire: "#B8885A", water: "#6B8FA3", air: "#8E96A0", earth: "#8E8058", spirit: "#C6A85E"
  };

  const firstName = name.split(" ")[0];

  let elementSections = "";
  for (const el of elementOrder) {
    const level = classify(scores[el]);
    const block = ELEMENT_BLOCKS[el][level];
    const color = elementColors[el];
    const adviceItems = block.advice.map(a => `<li style="margin-bottom:6px;">${a}</li>`).join("");

    elementSections += `
    <tr><td style="padding:32px 0 0;">
      <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:bold;color:${color};margin:0 0 4px;">${elementLabels[el]}</h2>
      <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#907E6A;margin:0 0 12px;">${elementSubtitles[el]}</p>
      <p style="font-size:13px;background:#F8F0E4;padding:8px 14px;border-radius:8px;display:inline-block;margin:0 0 16px;">
        Your score: <strong>${level}</strong>
      </p>
      <div style="font-size:15px;color:#62543E;line-height:1.8;margin-bottom:16px;">${block.body.replace(/\n\n/g, '</div><div style="font-size:15px;color:#62543E;line-height:1.8;margin-bottom:16px;">')}</div>
      <p style="font-size:15px;font-weight:bold;color:#44382C;margin:0 0 8px;">Practical guidance:</p>
      <ul style="font-size:15px;color:#62543E;line-height:1.8;padding-left:20px;margin:0 0 16px;">${adviceItems}</ul>
      <hr style="border:none;border-top:1px solid #DACAB6;margin:24px 0 0;" />
    </td></tr>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#F2E8D8;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2E8D8;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#FFFAF3;border-radius:16px;border:1px solid #DACAB6;overflow:hidden;">

  <!-- Header -->
  <tr><td style="padding:36px 36px 24px;border-bottom:1px solid #DACAB6;">
    <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:normal;color:#44382C;margin:0 0 6px;">Elemental Balance Analysis</h1>
    <p style="font-size:14px;color:#907E6A;font-style:italic;margin:0;">Personalised reflection based on your questionnaire responses</p>
  </td></tr>

  <!-- Opening -->
  <tr><td style="padding:28px 36px;">
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0 0 16px;">Hi ${firstName},</p>
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0 0 16px;">Thank you for taking the Elemental Analysis. What you filled in gives a snapshot of your current energetic balance. This is not a fixed identity. It reflects where you are right now.</p>
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0 0 16px;">From your answers, it is clear that ${strongest.name} plays a significant role in how you currently move through life. That is where we will start — and from there, the fuller picture begins to take shape.</p>
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0;">Below you'll find your results and what they suggest.</p>
  </td></tr>

  <!-- Overview -->
  <tr><td style="padding:0 36px 28px;">
    <hr style="border:none;border-top:1px solid #DACAB6;margin:0 0 24px;" />
    <p style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#907E6A;margin:0 0 16px;">Overview</p>
    <p style="font-size:15px;color:#62543E;line-height:1.6;margin:0 0 6px;">Your strongest element: <strong style="color:#44382C;">${strongest.name}</strong></p>
    <p style="font-size:15px;color:#62543E;line-height:1.6;margin:0 0 16px;">Your lowest element: <strong style="color:#44382C;">${weakest.name}</strong></p>
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0;">${personalised.overview}</p>
  </td></tr>

  <!-- Element sections -->
  <tr><td style="padding:0 36px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${elementSections}
    </table>
  </td></tr>

  <!-- Core Dynamic -->
  <tr><td style="padding:32px 36px;">
    <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#44382C;margin:0 0 4px;">Your Core Dynamic</h2>
    <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#907E6A;margin:0 0 16px;">What your elemental balance reveals</p>
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0;">${personalised.coreDynamic}</p>
  </td></tr>

  <!-- Reflective mirror -->
  <tr><td style="padding:0 36px 12px;">
    <p style="font-size:15px;color:#62543E;font-style:italic;line-height:1.8;margin:0;">If any part of this felt uncomfortable or resistant, that may be the exact place worth exploring.</p>
  </td></tr>

  <!-- Practical Next Steps -->
  <tr><td style="padding:24px 36px;">
    <hr style="border:none;border-top:1px solid #DACAB6;margin:0 0 24px;" />
    <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#44382C;margin:0 0 16px;">Practical Next Steps</h2>
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0 0 16px;">To rebalance your system, focus first on strengthening your lowest element. Do not try to optimise everything at once. One element, one practice, one month. That is enough to shift something real.</p>
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0 0 16px;">The practices listed above are things you can begin on your own. But elemental work goes deeper when it happens in a held environment — where the body, the mind, and the relational field are all engaged at once.</p>
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0 0 16px;">Our retreats are designed for exactly this. They are small, immersive, and structured around the five elements. Each retreat creates the conditions for the kind of integration that daily life often does not allow. If something in this analysis resonated, a retreat may be a meaningful next step.</p>
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0;">If you would prefer to start with individual guidance, 1:1 sessions and personalised action plans are also available. Just reply to this email and we can explore what fits.</p>
  </td></tr>

  <!-- Closing -->
  <tr><td style="padding:24px 36px 36px;">
    <hr style="border:none;border-top:1px solid #DACAB6;margin:0 0 24px;" />
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0 0 16px;">Your elements are not something you fix. They are something you learn to harmonise.</p>
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0 0 24px;">If you have questions about your results, just reply to this email.</p>
    <p style="font-size:15px;color:#44382C;line-height:1.8;margin:0;">Jim</p>
    <p style="font-size:15px;color:#907E6A;line-height:1.8;margin:0;">Elemental Discovery</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// ── Main handler ──
exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  // Rate limit
  const ip = event.headers["x-forwarded-for"] || event.headers["client-ip"] || "unknown";
  if (isRateLimited(ip)) {
    return { statusCode: 429, body: "Too many requests" };
  }

  try {
    const data = JSON.parse(event.body);

    // ── Validate required fields ──
    const { fullName, email, fire_mean, water_mean, air_mean, earth_mean, spirit_mean } = data;

    if (!fullName || !email || !fire_mean || !water_mean || !air_mean || !earth_mean || !spirit_mean) {
      return { statusCode: 400, body: "Missing required fields" };
    }

    // Validate scores are in range
    const scores = {
      fire: fire_mean, water: water_mean, air: air_mean,
      earth: earth_mean, spirit: spirit_mean
    };

    for (const [el, val] of Object.entries(scores)) {
      const n = parseFloat(val);
      if (isNaN(n) || n < 1 || n > 5) {
        return { statusCode: 400, body: `Invalid score for ${el}` };
      }
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { statusCode: 400, body: "Invalid email" };
    }

    // ── Classify and find strongest/weakest ──
    const { strongest, weakest } = findStrongestAndWeakest(scores);

    // ── Check automation toggle ──
    if (process.env.AUTOMATION_ENABLED !== "true") {
      console.log("Automation disabled — skipping email for", email);
      return { statusCode: 200, body: "Automation paused" };
    }

    // ── Call Claude API for personalised sections ──
    const personalised = await generatePersonalisedSections(scores, strongest, weakest);

    // ── Build email HTML ──
    const emailHtml = buildEmail(fullName, scores, strongest, weakest, personalised);

    // ── Send via Resend ──
    const sendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: "Elemental Discovery <analysis@elemental-discovery.com>",
        to: [email],
        subject: `Your Elemental Balance Analysis, ${fullName.split(" ")[0]}`,
        html: emailHtml
      })
    });

    const sendResult = await sendResponse.json();
    console.log("Email sent:", sendResult);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error("Pipeline error:", err);
    return { statusCode: 500, body: "Internal error" };
  }
};
