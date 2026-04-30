import {
  upsertCoreMemory,
  upsertAgentProfile,
  getAgentProfileByUserId,
} from "./_store.js";
import { sendWhatsAppMessage } from "./_twilio.js";
import { twimlMessage } from "./_twilio.js";
import { llmExtractOnboardingAnswer } from "./_llm.js";

const ONBOARDING_QUESTIONS = [
  {
    step: 1,
    memoryKey: "role",
    topic: "their role and work context",
    nextQuestion: "Nice! Now tell me — *what does a typical day look like for you?* (meetings, deep work, breaks, etc.)",
  },
  {
    step: 2,
    memoryKey: "typical_day",
    topic: "their typical daily routine",
    nextQuestion: "Got it. *What's your biggest productivity killer?* (procrastination, too many meetings, context switching, distractions...)",
  },
  {
    step: 3,
    memoryKey: "productivity_blocker",
    topic: "their main productivity blocker",
    nextQuestion: "Interesting. *Do you prefer working in short bursts (15-30 min) or deep focus blocks (1-2 hrs)?*",
  },
  {
    step: 4,
    memoryKey: "work_style",
    topic: "their preferred work style and task duration",
    nextQuestion: "Last one — *who are the key people you work with regularly?* (teammates, manager, clients, etc.)",
  },
  {
    step: 5,
    memoryKey: "key_people",
    topic: "key people they work with",
    nextQuestion: null, // Last question — no next
  },
];

const COMPLETION_MESSAGE = `That's everything I need! 🎯

Head back to 365 Tasks — your first day plan is being prepared right now.

From tomorrow, I'll send you a morning brief, midday nudge, and evening check-in. Talk soon!`;

/**
 * Handles a WhatsApp message from a user who is in the onboarding conversation.
 * Called from whatsapp-webhook.js when onboardingStep > 0 and !onboardingCompleted.
 */
export async function handleOnboardingChat(userId, rawText, profile, res) {
  const currentStep = profile.onboardingStep || 1;
  const question = ONBOARDING_QUESTIONS.find((q) => q.step === currentStep);

  if (!question) {
    // Shouldn't happen, but handle gracefully
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twimlMessage("Something went wrong with onboarding. Please try again from the app."));
  }

  // Extract the answer using LLM
  let extractedAnswer;
  try {
    extractedAnswer = await llmExtractOnboardingAnswer(rawText, question.topic);
  } catch {
    extractedAnswer = rawText.trim();
  }

  // Store in core memory
  await upsertCoreMemory(userId, question.memoryKey, extractedAnswer);

  // Advance to next step
  const nextStep = currentStep + 1;
  const isLastQuestion = !question.nextQuestion;

  const profileUpdate = {
    userId,
    whatsappNumber: profile.whatsAppNumber,
    timezone: profile.timezone,
    morningBriefTime: profile.morningBriefTime,
    middayNudgeTime: profile.middayNudgeTime,
    afternoonFollowupTime: profile.afternoonFollowupTime,
    eveningCheckinTime: profile.eveningCheckinTime,
    workdayStart: profile.workdayStart,
    workdayEnd: profile.workdayEnd,
    tone: profile.tone,
    nudgeIntensity: profile.nudgeIntensity,
    weekendsEnabled: profile.weekendsEnabled,
    autoplanEnabled: profile.autoplanEnabled,
    onboardingStep: isLastQuestion ? 6 : nextStep,
  };

  if (isLastQuestion) {
    profileUpdate.onboardingCompleted = true;
  }

  await upsertAgentProfile(profileUpdate);

  // Send next question or completion message
  const messageText = isLastQuestion ? COMPLETION_MESSAGE : question.nextQuestion;

  // Send via Twilio directly (not as TwiML reply) so it's a separate message
  await sendWhatsAppMessage({
    to: profile.whatsAppNumber,
    text: messageText,
  });

  // Reply with empty TwiML (the actual response is sent via Twilio API above)
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(twimlMessage(""));
}
