import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AIConfig } from "../types";

// AI 请求超时时间：避免网络异常时请求永久挂起
const AI_TIMEOUT_MS = 60000;

// 给任意 Promise 加超时限制（Gemini SDK 调用无原生 abort，用竞速方式兒底）
const withTimeout = <T,>(promise: Promise<T>, ms = AI_TIMEOUT_MS): Promise<T> =>
    Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`请求超时（${Math.round(ms / 1000)} 秒）`)), ms)
        )
    ]);

// 带超时的 fetch（OpenAI 兼容接口用）
const fetchWithTimeout = (url: string, init?: RequestInit): Promise<Response> =>
    fetch(url, { ...init, signal: AbortSignal.timeout(AI_TIMEOUT_MS) });

/**
 * 把用户填写的 OpenAI 兼容 Base URL 归一化为以 /v{n} 结尾的根路径：
 * - 去掉尾部斜杠与误填的 /chat/completions 后缀
 * - 未带版本号时补上 /v1（如 api.openai.com → https://api.openai.com/v1）
 * 已带 /v2、/v4 等其他版本的地址保持不变
 */
const resolveOpenAIBase = (rawBaseUrl: string): string => {
    let base = (rawBaseUrl || '').trim().replace(/\/+$/, '');
    if (base.endsWith('/chat/completions')) {
        base = base.slice(0, -'/chat/completions'.length).replace(/\/+$/, '');
    }
    if (!/\/v\d+$/.test(base)) {
        base += '/v1';
    }
    return base;
};

/**
 * Helper to call OpenAI Compatible API
 */
const callOpenAICompatible = async (config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> => {
    try {
        const baseUrl = `${resolveOpenAIBase(config.baseUrl)}/chat/completions`;

        const response = await fetchWithTimeout(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error("OpenAI API Error:", err);
            return "";
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() || "";
    } catch (e) {
        console.error("OpenAI Call Failed", e);
        return "";
    }
};

export interface AIConnectionTestResult {
  ok: boolean;
  message: string;
  models?: string[]; // OpenAI 兼容接口可用模型列表
}

/**
 * Tests AI API connectivity with the given config.
 * - Gemini: sends a minimal generateContent request
 * - OpenAI Compatible: tries GET /models first, falls back to a minimal chat completion
 */
export const testAIConnection = async (config: AIConfig): Promise<AIConnectionTestResult> => {
  if (!config.apiKey) {
    return { ok: false, message: '请先填写 API Key' };
  }

  try {
    if (config.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: config.apiKey });
      const modelName = config.model || 'gemini-2.5-flash';
      await withTimeout(ai.models.generateContent({
        model: modelName,
        contents: 'ping',
      }));
      return { ok: true, message: `连接成功，模型 ${modelName} 可用` };
    }

    // OpenAI Compatible: resolve base url the same way as callOpenAICompatible
    const base = resolveOpenAIBase(config.baseUrl);

    // Try listing models first
    try {
      const res = await fetchWithTimeout(`${base}/models`, {
        headers: { 'Authorization': `Bearer ${config.apiKey}` }
      });
      if (res.ok) {
        const data: unknown = await res.json();
        const modelItems = data && typeof data === 'object'
          ? ('data' in data && Array.isArray(data.data)
              ? data.data
              : 'models' in data && Array.isArray(data.models)
                ? data.models
                : [])
          : [];
        const models = modelItems
          .map((model): string => {
            if (!model || typeof model !== 'object') return '';
            if ('id' in model && typeof model.id === 'string') return model.id;
            if ('name' in model && typeof model.name === 'string') return model.name;
            return '';
          })
          .filter((model): model is string => Boolean(model));
        if (models.length > 0) {
          return { ok: true, message: `连接成功，发现 ${models.length} 个可用模型`, models };
        }
        return { ok: true, message: '连接成功，但未返回模型列表' };
      }
    } catch {
      // /models not supported, fall through to chat test
    }

    // Fallback: minimal chat completion
    const res = await fetchWithTimeout(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5
      })
    });
    if (res.ok) {
      return { ok: true, message: `连接成功，模型 ${config.model} 可用` };
    }
    const errText = await res.text();
    return { ok: false, message: `连接失败 (${res.status}): ${errText.slice(0, 120)}` };
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : '网络错误';
    return { ok: false, message: `连接失败: ${message}` };
  }
};

/**
 * Uses configured AI to generate a description
 */
export const generateLinkDescription = async (title: string, url: string, config: AIConfig): Promise<string> => {
  if (!config.apiKey) {
    return "请在设置中配置 API Key";
  }

  const prompt = `
      Title: ${title}
      URL: ${url}
      Please write a very short description (max 15 words) in Chinese (Simplified) that explains what this website is for. Return ONLY the description text. No quotes.
  `;

  try {
    if (config.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: config.apiKey });
        // Use user defined model or fallback
        const modelName = config.model || 'gemini-2.5-flash';
        
        const response: GenerateContentResponse = await withTimeout(ai.models.generateContent({
            model: modelName,
            contents: `I have a website bookmark. ${prompt}`,
        }));
        return response.text ? response.text.trim() : "无法生成描述";
    } else {
        // OpenAI Compatible
        const result = await callOpenAICompatible(
            config, 
            "You are a helpful assistant that summarizes website bookmarks.", 
            prompt
        );
        return result || "生成描述失败";
    }
  } catch (error) {
    console.error("AI generation error:", error);
    return "生成描述失败";
  }
};

/**
 * Suggests a category
 */
export const suggestCategory = async (title: string, url: string, categories: {id: string, name: string}[], config: AIConfig): Promise<string | null> => {
    if (!config.apiKey) return null;

    const catList = categories.map(c => `${c.id}: ${c.name}`).join('\n');
    const prompt = `
        Website: "${title}" (${url})

        Available Categories:
        ${catList}

        Return ONLY the 'id' of the best matching category. If unsure, return 'common'.
    `;

    try {
        if (config.provider === 'gemini') {
            const ai = new GoogleGenAI({ apiKey: config.apiKey });
            const modelName = config.model || 'gemini-2.5-flash';
            
            const response: GenerateContentResponse = await withTimeout(ai.models.generateContent({
                model: modelName,
                contents: `Task: Categorize this website.\n${prompt}`,
            }));
            return response.text ? response.text.trim() : null;
        } else {
             // OpenAI Compatible
            const result = await callOpenAICompatible(
                config,
                "You are an intelligent classification assistant. You only output the category ID.",
                prompt
            );
            return result || null;
        }
    } catch (e) {
        console.error(e);
        return null;
    }
}
