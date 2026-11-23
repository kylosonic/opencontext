const OPENCODE_BASE_URL = "https://opencode.ai/inference/go/openai/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

export function parseDemoInvocation(env, argv) {
  const args = [...argv];
  const dockerArgs = args[0] === "--" ? args.slice(1) : args;
  const configuredMode = env.OPENCONTEXT_DEMO_VISION?.trim() || "";
  let mode = configuredMode || "fixture";
  let explicitMode = Boolean(configuredMode);
  if (dockerArgs[0] === "real" || dockerArgs[0] === "fixture") {
    mode = dockerArgs.shift();
    explicitMode = true;
  }
  return { dockerArgs, mode, explicitMode };
}

export function selectDemoProvider(env) {
  const geminiApiKey = env.GEMINI_API_KEY?.trim() ?? "";
  const openaiApiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const opencodeApiKey = env.OPENCODE_API_KEY?.trim() ?? "";
  const useGemini = Boolean(geminiApiKey);
  const useOpenAI = !useGemini && Boolean(openaiApiKey);
  const useOpenCode = !useGemini && !useOpenAI && Boolean(opencodeApiKey);
  return {
    useGemini,
    useOpenAI,
    useOpenCode,
    geminiApiKey,
    openaiApiKey,
    opencodeApiKey,
    geminiModel: env.OPENCONTEXT_DEMO_MODEL || "gemini-4-hydrogen",
    openaiBaseUrl:
      env.OPENAI_BASE_URL || (useOpenCode ? OPENCODE_BASE_URL : OPENAI_BASE_URL),
  };
}
