import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AIConfig } from "../types";

/**
 * Helper to call OpenAI Compatible API
 */
const callOpenAICompatible = async (config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> => {
    try {
        let baseUrl = config.baseUrl.replace(/\/$/, '');
        // If user didn't provide full path, assume /v1/chat/completions logic or just trust them
        // Common convention: if URL ends with /v1, append /chat/completions
        if (!baseUrl.includes('/chat/completions')) {
            if (baseUrl.endsWith('/v1')) {
                baseUrl += '/chat/completions';
            } else {
                // If it's just a domain like api.openai.com, usually implies /v1/chat/completions
                // But let's assume user might input full path or standard base. 
                // To be safe, let's append /chat/completions if not present
                baseUrl += '/chat/completions';
            }
        }

        const response = await fetch(baseUrl, {
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
      await ai.models.generateContent({
        model: modelName,
        contents: 'ping',
      });
      return { ok: true, message: `连接成功，模型 ${modelName} 可用` };
    }

    // OpenAI Compatible: resolve base url the same way as callOpenAICompatible
    let base = config.baseUrl.replace(/\/$/, '');
    if (base.includes('/chat/completions')) {
      base = base.replace(/\/chat\/completions$/, '');
    } else if (!base.endsWith('/v1')) {
      base += '/v1';
    }

    // Try listing models first
    try {
      const res = await fetch(`${base}/models`, {
        headers: { 'Authorization': `Bearer ${config.apiKey}` }
      });
      if (res.ok) {
        const data = await res.json();
        const models: string[] = (data.data || data.models || [])
          .map((m: any) => m.id || m.name || '')
          .filter(Boolean);
        if (models.length > 0) {
          return { ok: true, message: `连接成功，发现 ${models.length} 个可用模型`, models };
        }
        return { ok: true, message: '连接成功，但未返回模型列表' };
      }
    } catch {
      // /models not supported, fall through to chat test
    }

    // Fallback: minimal chat completion
    const res = await fetch(`${base}/chat/completions`, {
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
  } catch (e: any) {
    return { ok: false, message: `连接失败: ${e?.message || '网络错误'}` };
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
        
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: modelName,
            contents: `I have a website bookmark. ${prompt}`,
        });
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
            
            const response: GenerateContentResponse = await ai.models.generateContent({
                model: modelName,
                contents: `Task: Categorize this website.\n${prompt}`,
            });
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
