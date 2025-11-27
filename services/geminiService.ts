import { GoogleGenAI, Modality } from "@google/genai";
import { Language } from "../types";

// Initialize Gemini Client
// Note: In a real production app, ensure the API key is handled securely.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

const SYSTEM_INSTRUCTION_AR = `
أنت عالم متخصص في القرآن الكريم وتفسيره.
المستخدم سيطلب منك تفسير آيات أو سور محددة.
المرجع الأساسي لك هو كتاب "التفسير الميسر".
- قدم التفسير بأسلوب سهل، واضح، ومباشر، مناسب لجميع القراء.
- اشرح معاني المفردات الصعبة باختصار إذا لزم الأمر.
- ركز على المعنى الإجمالي للآية والهداية المستفادة منها.
- تجنب التفاصيل اللغوية المعقدة أو الخلافات الفقهية.
- كن مهذباً ومحترماً جداً للنص القرآني.
`;

const SYSTEM_INSTRUCTION_EN = `
You are a scholar and expert in the interpretation of the Holy Quran, specifically focusing on "Tafsir Al-Muyassar" (The Facilitated Interpretation).
Your task is to provide accurate, profound, and accessible interpretations (Tafsir) for verses or chapters requested by the user.
- Adhere to authentic scholarly interpretations (Ahl al-Sunnah wal-Jama'ah).
- Use clear, dignified, and simple English (matching the style of Tafsir Al-Muyassar).
- Avoid complex linguistic or jurisprudential debates unless necessary.
- Focus on the direct meaning and practical guidance of the verses.
`;

export const generateTafsir = async (query: string, language: Language): Promise<string> => {
  try {
    const systemInstruction = language === Language.ARABIC ? SYSTEM_INSTRUCTION_AR : SYSTEM_INSTRUCTION_EN;
    const modelId = 'gemini-2.5-flash';

    const response = await ai.models.generateContent({
      model: modelId,
      contents: query,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.3, // Lower temperature for more factual/consistent religious content
      },
    });

    return response.text || (language === Language.ARABIC ? "عذراً، لم أتمكن من استخراج التفسير." : "Sorry, I could not generate the interpretation.");
  } catch (error) {
    console.error("Error generating tafsir:", error);
    throw error;
  }
};

export const generateSpeech = async (text: string, language: Language): Promise<ArrayBuffer> => {
  try {
    // 'Charon' is a deep male voice, suitable for serious content like Tafsir.
    const voiceName = 'Charon'; 
    
    // We strictly use the 2.5 flash preview tts model
    const modelId = "gemini-2.5-flash-preview-tts";

    const response = await ai.models.generateContent({
      model: modelId,
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!base64Audio) {
      throw new Error("No audio data received");
    }

    return decodeBase64ToBuffer(base64Audio);

  } catch (error) {
    console.error("Error generating speech:", error);
    throw error;
  }
};

// Helper to decode Base64 string to ArrayBuffer
const decodeBase64ToBuffer = (base64: string): ArrayBuffer => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};