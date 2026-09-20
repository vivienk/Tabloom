type LanguageModelAvailability = "available" | "downloadable" | "downloading" | "unavailable";

interface LanguageModelSession {
  prompt(input: string): Promise<string>;
  destroy(): void;
}

interface LanguageModelCreateOptions {
  initialPrompts?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  monitor?: (monitor: EventTarget) => void;
}

interface LanguageModelAPI {
  availability(): Promise<LanguageModelAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

declare const LanguageModel: LanguageModelAPI | undefined;
