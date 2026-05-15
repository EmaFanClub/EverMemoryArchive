import { GoogleGenAI } from "@google/genai";
import type { GoogleGenAIOptions } from "@google/genai";

export const GOOGLE_AI_API_VERSION = "v1beta";
export const VERTEX_AI_API_VERSION = "v1";
export const GOOGLE_VERTEX_AI_SCOPE =
  "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_VERTEX_AI_LOCATION = "global";

export interface GoogleVertexAIConfig {
  credentialsJson: string;
}

type GoogleCredentials = NonNullable<
  NonNullable<GoogleGenAIOptions["googleAuthOptions"]>["credentials"]
>;

function parseGoogleCredentialsJson(value: string): GoogleCredentials {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Google Vertex AI credentials JSON is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Google Vertex AI credentials must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Google Vertex AI credentials must be a JSON object.");
  }

  return parsed as GoogleCredentials;
}

export function isGoogleVertexCredentialsJson(value: string): boolean {
  return value.trim().startsWith("{");
}

/** Builds Vertex AI options from database-backed Google embedding config. */
export function buildGoogleVertexAIOptions(
  config: GoogleVertexAIConfig,
): GoogleGenAIOptions {
  const credentials = parseGoogleCredentialsJson(config.credentialsJson);
  const project = getGoogleCredentialsProjectId(credentials);
  return {
    apiVersion: VERTEX_AI_API_VERSION,
    vertexai: true,
    project,
    location: DEFAULT_VERTEX_AI_LOCATION,
    googleAuthOptions: {
      credentials,
      scopes: [GOOGLE_VERTEX_AI_SCOPE],
    },
  };
}

function getGoogleCredentialsProjectId(credentials: GoogleCredentials): string {
  const projectId = (credentials as Record<string, unknown>).project_id;
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new Error(
      "Google Vertex AI credentials JSON must include project_id.",
    );
  }
  return projectId.trim();
}

/**
 * Google Generative AI client that keeps EMA's proxy and Vertex AI env behavior.
 */
export class GenAI extends GoogleGenAI {
  constructor(
    options: GoogleGenAIOptions,
    private readonly fetcher: (
      url: string,
      requestInit?: RequestInit,
    ) => Promise<Response>,
  ) {
    const restoreEnv = suppressGoogleApiKeyEnvForVertex(options);
    try {
      super({ ...options });
    } finally {
      restoreEnv();
    }
    if (!(this.apiClient as any).apiCall) {
      throw new Error("apiCall cannot be patched");
    }
    (this.apiClient as any).apiCall = async (url: string, requestInit: any) => {
      return this.fetcher(url, requestInit).catch((error) => {
        throw new Error(`exception ${error} sending request`);
      });
    };
  }
}

function suppressGoogleApiKeyEnvForVertex(
  options: GoogleGenAIOptions,
): () => void {
  if (!options.vertexai) {
    return () => {};
  }

  const googleApiKey = process.env.GOOGLE_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;

  return () => {
    if (googleApiKey === undefined) {
      delete process.env.GOOGLE_API_KEY;
    } else {
      process.env.GOOGLE_API_KEY = googleApiKey;
    }
    if (geminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = geminiApiKey;
    }
  };
}
