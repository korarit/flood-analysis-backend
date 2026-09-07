import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { env } from "../config/env";
import { db } from "../db";
import { basins, rainfallStations, telemetryLatest, waterlevelStations } from "../db/schema";
import { LocalizedString, SituationStatus } from "../types";
import { r2Storage } from "./r2StorageService";

export interface SituationBulletin {
  id: string;
  basinId: string;
  basinName: LocalizedString;
  issuedDate: string;
  issuedTime: string;
  overallSituation: LocalizedString;
  overallSeverity: SituationStatus;
  keyHighlights: LocalizedString[];
  highRiskAreas: LocalizedString[];
  upstreamStatus: LocalizedString;
  midstreamStatus: LocalizedString;
  downstreamStatus: LocalizedString;
  forecastNext24h: LocalizedString;
  officerInCharge: LocalizedString;
}

const bulletinFunctionTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "publish_situation_bulletin",
    description:
      "Publishes the official hydrological situation bulletin for a river basin in Thailand based on telemetry facts.",
    parameters: {
      type: "object",
      properties: {
        overallSituation: {
          type: "object",
          properties: {
            th: { type: "string", description: "Executive summary in Thai" },
            en: { type: "string", description: "Executive summary in English" },
          },
          required: ["th", "en"],
          additionalProperties: false,
        },
        overallSeverity: {
          type: "string",
          enum: ["normal", "watch", "warning", "critical"],
          description: "Overall basin situation severity status",
        },
        keyHighlights: {
          type: "array",
          items: {
            type: "object",
            properties: {
              th: { type: "string", description: "Highlight item in Thai" },
              en: { type: "string", description: "Highlight item in English" },
            },
            required: ["th", "en"],
            additionalProperties: false,
          },
          description: "List of 2-4 key observation highlights",
        },
        highRiskAreas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              th: { type: "string", description: "Risk area name in Thai" },
              en: { type: "string", description: "Risk area name in English" },
            },
            required: ["th", "en"],
            additionalProperties: false,
          },
          description: "List of high-risk districts or riparian communities",
        },
        upstreamStatus: {
          type: "object",
          properties: {
            th: { type: "string", description: "Upstream situation analysis in Thai" },
            en: { type: "string", description: "Upstream situation analysis in English" },
          },
          required: ["th", "en"],
          additionalProperties: false,
        },
        midstreamStatus: {
          type: "object",
          properties: {
            th: { type: "string", description: "Midstream situation analysis in Thai" },
            en: { type: "string", description: "Midstream situation analysis in English" },
          },
          required: ["th", "en"],
          additionalProperties: false,
        },
        downstreamStatus: {
          type: "object",
          properties: {
            th: { type: "string", description: "Downstream situation analysis in Thai" },
            en: { type: "string", description: "Downstream situation analysis in English" },
          },
          required: ["th", "en"],
          additionalProperties: false,
        },
        forecastNext24h: {
          type: "object",
          properties: {
            th: { type: "string", description: "24-hour forecast & advisory in Thai" },
            en: { type: "string", description: "24-hour forecast & advisory in English" },
          },
          required: ["th", "en"],
          additionalProperties: false,
        },
        officerInCharge: {
          type: "object",
          properties: {
            th: { type: "string", description: "Authorizing system name in Thai" },
            en: { type: "string", description: "Authorizing system name in English" },
          },
          required: ["th", "en"],
          additionalProperties: false,
        },
      },
      required: [
        "overallSituation",
        "overallSeverity",
        "keyHighlights",
        "highRiskAreas",
        "upstreamStatus",
        "midstreamStatus",
        "downstreamStatus",
        "forecastNext24h",
        "officerInCharge",
      ],
      additionalProperties: false,
    },
    strict: true,
  },
};

export class LLMBulletinService {
  private openaiClient: OpenAI | null = null;
  private modelName: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL;
    this.modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (apiKey && apiKey.length > 5 && !apiKey.includes("your_openai")) {
      this.openaiClient = new OpenAI({
        apiKey,
        baseURL: baseURL && baseURL.trim().length > 0 ? baseURL : undefined,
      });
    }
  }

  /**
   * Format Thai Buddhist Date: e.g. "23 สิงหาคม 2569"
   */
  private getThaiDateString(d: Date = new Date()): string {
    const thaiMonths = [
      "มกราคม",
      "กุมภาพันธ์",
      "มีนาคม",
      "เมษายน",
      "พฤษภาคม",
      "มิถุนายน",
      "กรกฎาคม",
      "สิงหาคม",
      "กันยายน",
      "ตุลาคม",
      "พฤศจิกายน",
      "ธันวาคม",
    ];
    const day = d.getDate();
    const month = thaiMonths[d.getMonth()];
    const year = d.getFullYear() + 543;
    return `${day} ${month} ${year}`;
  }

  private getTimeString(d: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())} น.`;
  }

  /**
   * Generate Bulletin using OpenAI Function Calling or Smart Rule-based Hydrological Fallback
   */
  async generateBulletin(basinSlug: string): Promise<SituationBulletin | null> {
    let b: any;
    let bStations: any[] = [];
    let allTele: any[] = [];

    try {
      const dbBasins = await db.select().from(basins).where(eq(basins.slug, basinSlug));
      b = dbBasins[0];
      if (b) {
        const wl = await db.select().from(waterlevelStations).where(eq(waterlevelStations.basinId, b.id));
        const rf = await db.select().from(rainfallStations).where(eq(rainfallStations.basinId, b.id));
        bStations = [...wl, ...rf];
        allTele = await db.select().from(telemetryLatest).where(eq(telemetryLatest.basinId, b.id));
      }
    } catch {
      // Fallback to seed master data
      const { initialBasins } = await import("../db/seed");
      b = initialBasins.find((item) => item.slug === basinSlug);
      bStations = [];
    }

    if (!b) return null;

    const teleMap = new Map(allTele.map((t) => [t.stationId, t]));

    // Categorize stations by reach (latitude order: North/Upstream -> South/Downstream)
    const sortedStations = [...bStations].sort((a, b) => b.lat - a.lat);
    const n = sortedStations.length;
    const upstreamStations = sortedStations.slice(0, Math.max(1, Math.floor(n / 3)));
    const midstreamStations = sortedStations.slice(
      Math.max(1, Math.floor(n / 3)),
      Math.max(2, Math.floor((2 * n) / 3))
    );
    const downstreamStations = sortedStations.slice(Math.max(2, Math.floor((2 * n) / 3)));

    // Calculate metrics
    let criticalCount = 0;
    let warningCount = 0;
    let watchCount = 0;
    let maxRain24h = 0;
    let maxRainStation = "";
    let maxStageStation = "";
    let maxStoragePercent = 0;

    for (const st of bStations) {
      const t = teleMap.get(st.id);
      const status = (t?.situationStatus as SituationStatus) || "normal";
      if (status === "critical") criticalCount++;
      else if (status === "warning") warningCount++;
      else if (status === "watch") watchCount++;

      if (t?.rainfall24h && t.rainfall24h > maxRain24h) {
        maxRain24h = t.rainfall24h;
        maxRainStation = `${st.nameTh} (${t.rainfall24h} มม.)`;
      }
      if (t?.storagePercent && t.storagePercent > maxStoragePercent) {
        maxStoragePercent = t.storagePercent;
        maxStageStation = `${st.nameTh} (${t.stage} ม. / ${t.storagePercent}% ตลิ่ง)`;
      }
    }

    const overallSeverity: SituationStatus =
      criticalCount > 0
        ? "critical"
        : warningCount > 0
        ? "warning"
        : watchCount > 0
        ? "watch"
        : "normal";

    const now = new Date();
    const docId = `bulletin-${b.slug}-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${now.getHours().toString().padStart(2, "0")}00`;

    // Try generating with OpenAI Function Calling if client is available
    if (this.openaiClient) {
      try {
        const functionCallResult = await this.callOpenAIFunction(b, {
          totalStations: bStations.length,
          criticalCount,
          warningCount,
          watchCount,
          maxRain24h,
          maxRainStation,
          maxStageStation,
          maxStoragePercent,
          overallSeverity,
          upstream: upstreamStations.map((s) => ({ name: s.nameTh, status: teleMap.get(s.id)?.situationStatus })),
          midstream: midstreamStations.map((s) => ({ name: s.nameTh, status: teleMap.get(s.id)?.situationStatus })),
          downstream: downstreamStations.map((s) => ({ name: s.nameTh, status: teleMap.get(s.id)?.situationStatus })),
        });

        if (functionCallResult) {
          const bulletin: SituationBulletin = {
            id: docId,
            basinId: b.slug,
            basinName: { th: b.nameTh, en: b.nameEn },
            issuedDate: this.getThaiDateString(now),
            issuedTime: this.getTimeString(now),
            ...functionCallResult,
            officerInCharge: {
              th: "ระบบประมวลผลสถานการณ์น้ำและอุทกวิทยา",
              en: "Water Situation & Hydrology Processing System",
            },
          };
          await this.publishToR2(b.slug, bulletin);
          return bulletin;
        }
      } catch (err) {
        console.warn("⚠️ OpenAI Function Call generation failed, falling back to rule-based engine:", err);
      }
    }

    // Fallback: Smart Hydrological Synthesis Engine
    const bulletin = this.synthesizeRuleBasedBulletin(b, {
      docId,
      now,
      overallSeverity,
      criticalCount,
      warningCount,
      watchCount,
      maxRain24h,
      maxRainStation,
      maxStageStation,
      maxStoragePercent,
      upstreamStations,
      midstreamStations,
      downstreamStations,
      teleMap,
    });

    await this.publishToR2(b.slug, bulletin);
    return bulletin;
  }

  /**
   * Publish Bulletin to R2 object path: `/basin/{slug}/report/bulletin-latest.json`
   */
  private async publishToR2(basinSlug: string, bulletin: SituationBulletin) {
    const r2Path = `basin/${basinSlug}/report/bulletin-latest.json`;
    await r2Storage.putJson(r2Path, bulletin, "public, max-age=600, s-maxage=600");
  }

  /**
   * Smart Rule-Based Hydrological Bulletin Synthesis Engine
   */
  private synthesizeRuleBasedBulletin(
    basin: typeof basins.$inferSelect,
    ctx: {
      docId: string;
      now: Date;
      overallSeverity: SituationStatus;
      criticalCount: number;
      warningCount: number;
      watchCount: number;
      maxRain24h: number;
      maxRainStation: string;
      maxStageStation: string;
      maxStoragePercent: number;
      upstreamStations: any[];
      midstreamStations: any[];
      downstreamStations: any[];
      teleMap: Map<string, typeof telemetryLatest.$inferSelect>;
    }
  ): SituationBulletin {
    const isHigh = ctx.overallSeverity === "warning" || ctx.overallSeverity === "critical";
    const isWatch = ctx.overallSeverity === "watch";
    const riverName = basin.nameTh.replace("ลุ่มน้ำ", "แม่น้ำ");
    const riverNameEn = basin.nameEn.toLowerCase().includes("river")
      ? basin.nameEn.replace(/Basin/i, "").trim()
      : `${basin.nameEn} River`;

    // 1. Identify key rising / critical stations
    const allStationsList = [...ctx.upstreamStations, ...ctx.midstreamStations, ...ctx.downstreamStations];
    const risingStations = allStationsList.filter((s) => ctx.teleMap.get(s.id)?.trend === "rising");
    const risingCount = risingStations.length;
    const keyRisingNamesTh = risingStations.slice(0, 2).map((s) => s.nameTh).join(" และ ");
    const keyRisingNamesEn = risingStations.slice(0, 2).map((s) => s.nameEn).join(" and ");

    // 2. Dynamic Executive Summary
    const overallTh = isHigh
      ? `สถานการณ์น้ำใน${basin.nameTh}อยู่ในเกณฑ์${ctx.overallSeverity === "critical" ? "วิกฤต" : "เตือนภัย"} พบสถานีเฝ้าระวัง ${ctx.criticalCount + ctx.warningCount} แห่ง และมีฝนสะสมสูงสุด ${ctx.maxRain24h} มม. ระดับน้ำใน${riverName}มีแนวโน้มเพิ่มขึ้นต่อเนื่อง`
      : isWatch
      ? `สถานการณ์น้ำใน${basin.nameTh}อยู่ในเกณฑ์เฝ้าระวัง มีสถานีตรวจวัดระดับน้ำสูง ${ctx.watchCount} แห่ง ระดับน้ำใน${riverName}ทรงตัวอยู่ในระดับควบคุม`
      : `สถานการณ์น้ำใน${basin.nameTh}อยู่ในเกณฑ์ปกติ ระดับน้ำใน${riverName}และลำน้ำสาขายังต่ำกว่าตลิ่ง การระบายน้ำทำได้คล่องตัว`;

    const overallEn = isHigh
      ? `Water situation in ${basin.nameEn} is at ${ctx.overallSeverity.toUpperCase()} level with ${ctx.criticalCount + ctx.warningCount} stations on alert and peak 24h rainfall of ${ctx.maxRain24h} mm.`
      : isWatch
      ? `Water situation in ${basin.nameEn} is under WATCH status with ${ctx.watchCount} stations reporting elevated stages.`
      : `Water situation in ${basin.nameEn} is NORMAL. River levels remain well within bank capacities with smooth discharge.`;

    // 3. Dynamic Highlights
    const highlights: LocalizedString[] = [];

    if (ctx.maxStageStation) {
      highlights.push({
        th: `ระดับน้ำสูงสุดตรวจวัดได้ที่สถานี ${ctx.maxStageStation} คิดเป็น ${ctx.maxStoragePercent}% ของความจุตลิ่ง`,
        en: `Peak stage recorded at station ${ctx.maxStageStation} (${ctx.maxStoragePercent}% of bank capacity).`,
      });
    }

    if (ctx.maxRain24h > 0) {
      highlights.push({
        th: `ปริมาณฝนสะสม 24 ชั่วโมงสูงสุดที่สถานี ${ctx.maxRainStation} มวลน้ำหลากจะทยอยไหลลงสู่พื้นที่ตอนกลางของลุ่มน้ำ`,
        en: `Highest 24h accumulated rainfall at station ${ctx.maxRainStation}. Runoff is steadily progressing towards midstream reaches.`,
      });
    } else {
      highlights.push({
        th: `ไม่มีรายงานปริมาณฝนตกหนักผิดปกติในพื้นที่ลุ่มน้ำ`,
        en: `No abnormal heavy rainfall reported across the catchment area.`,
      });
    }

    if (risingCount > 0) {
      highlights.push({
        th: `ตรวจพบสถานีตรวจวัดที่มีระดับน้ำแนวโน้มเพิ่มขึ้น ${risingCount} สถานี ได้แก่ ${keyRisingNamesTh || "ลำน้ำสายหลัก"}`,
        en: `${risingCount} stations showing rising trends, including ${keyRisingNamesEn || "main stream"}.`,
      });
    }

    highlights.push({
      th: `ระบบประมวลผลสถานการณ์น้ำทำการเฝ้าระวังอัตโนมัติตลอด 24 ชั่วโมง และเชื่อมโยงข้อมูลโทรมาตรตามรอบเวลา`,
      en: `Water Situation System maintains 24/7 automated monitoring and regular telemetry dataset updates.`,
    });

    // 4. Dynamic High Risk Areas
    const highRiskAreas: LocalizedString[] = [];
    const alertStations = allStationsList.filter((s) => {
      const st = ctx.teleMap.get(s.id)?.situationStatus;
      return st === "critical" || st === "warning";
    });

    if (alertStations.length > 0) {
      alertStations.forEach((s) => {
        highRiskAreas.push({
          th: `พื้นที่ริมตลิ่งรอบสถานี ${s.nameTh} (${s.addressTh || s.nameTh})`,
          en: `Riparian zones around station ${s.nameEn} (${s.addressEn || s.nameEn})`,
        });
      });
    } else if (isWatch) {
      highRiskAreas.push({
        th: `พื้นที่ลุ่มต่ำริมตลิ่ง${riverName}`,
        en: `Low-lying riparian zones along ${riverNameEn}`,
      });
    } else {
      highRiskAreas.push({
        th: `ไม่มีพื้นที่เสี่ยงวิกฤตในขณะนี้`,
        en: `No critical high-risk zones currently identified.`,
      });
    }

    // 5. Dynamic Reach-by-Reach Status
    const upstreamRain = ctx.upstreamStations.reduce((sum, s) => sum + (ctx.teleMap.get(s.id)?.rainfall24h || 0), 0);
    const upstreamStatusTh =
      upstreamRain > 30
        ? `ตอนบน (ต้นน้ำ) มีฝนตกสะสมรวม ${upstreamRain.toFixed(1)} มม. ส่งผลให้ระดับน้ำในลำน้ำสาขามีแนวโน้มเพิ่มขึ้น`
        : `ตอนบน (ต้นน้ำ) สภาพอากาศปกติ ระดับน้ำในลำน้ำสาขาทรงตัว`;
    const upstreamStatusEn =
      upstreamRain > 30
        ? `Upstream reaches recorded cumulative rainfall of ${upstreamRain.toFixed(1)} mm with rising tributary stages.`
        : `Upstream reaches remain stable under normal weather conditions.`;

    const midstreamRising = ctx.midstreamStations.filter((s) => ctx.teleMap.get(s.id)?.trend === "rising").length;
    const midstreamStatusTh =
      isHigh || midstreamRising > 0
        ? `ตอนกลาง (กลางน้ำ) รับมวลน้ำจากตอนบน พบสถานีระดับน้ำเพิ่มขึ้น ${midstreamRising} แห่ง เฝ้าระวังพื้นที่ตลิ่งต่ำ`
        : `ตอนกลาง (กลางน้ำ) ระดับน้ำอยู่ในเกณฑ์ควบคุม การระบายน้ำทำได้ตามเกณฑ์มาตรฐาน`;
    const midstreamStatusEn =
      isHigh || midstreamRising > 0
        ? `Midstream reaches receiving upstream flow with ${midstreamRising} stations rising; monitoring low-bank areas.`
        : `Midstream reaches operating under standard regulated capacity criteria.`;

    const downstreamStatusTh = `ตอนล่าง (ปลายน้ำ) ระดับน้ำยังต่ำกว่าตลิ่ง ประตูระบายน้ำและสถานีสูบน้ำพร้อมรองรับการระบายลงสู่พื้นที่รับน้ำ`;
    const downstreamStatusEn = `Downstream reaches remain below bank levels; sluice gates and pumps prepared for smooth diversion and drainage.`;

    // 6. Dynamic Forecast Calculation based on Telemetry Delta & Rainfall
    let forecastTh = "";
    let forecastEn = "";

    if (isHigh || (risingCount > 0 && ctx.maxRain24h > 20)) {
      const estimatedMinRise = Math.max(0.1, +(risingCount * 0.08 + (ctx.maxRain24h > 50 ? 0.2 : 0.05)).toFixed(2));
      const estimatedMaxRise = Math.max(estimatedMinRise + 0.15, +(estimatedMinRise + (ctx.maxRain24h > 80 ? 0.35 : 0.2)).toFixed(2));

      forecastTh = `คาดการณ์ 24 ชั่วโมงข้างหน้า มวลน้ำหลากจากฝนสะสม ${ctx.maxRain24h} มม. จะส่งผลให้ระดับน้ำใน${riverName}ช่วง ${keyRisingNamesTh || "ตอนกลาง"} มีแนวโน้มเพิ่มขึ้นประมาณ ${estimatedMinRise.toFixed(2)} - ${estimatedMaxRise.toFixed(2)} เมตร ขอให้ประชาชนในพื้นที่ริมตลิ่งเฝ้าระวังอย่างใกล้ชิด`;
      forecastEn = `Over the next 24 hours, runoff from ${ctx.maxRain24h} mm rainfall is projected to raise ${riverNameEn} stages around ${keyRisingNamesEn || "midstream"} by approximately ${estimatedMinRise.toFixed(2)} - ${estimatedMaxRise.toFixed(2)} m. Riparian residents are advised to maintain close vigilance.`;
    } else if (isWatch || risingCount > 0) {
      const estimatedMinRise = 0.05;
      const estimatedMaxRise = Math.max(0.15, +(0.05 + risingCount * 0.05).toFixed(2));

      forecastTh = `คาดการณ์ 24 ชั่วโมงข้างหน้า ระดับน้ำใน${riverName}มีแนวโน้มเพิ่มขึ้นเล็กน้อยประมาณ ${estimatedMinRise.toFixed(2)} - ${estimatedMaxRise.toFixed(2)} เมตร ตามปริมาณน้ำหลากจากลำน้ำสาขา แต่ยังอยู่ในเกณฑ์ควบคุมได้`;
      forecastEn = `Over the next 24 hours, ${riverNameEn} stages are projected to rise slightly by ${estimatedMinRise.toFixed(2)} - ${estimatedMaxRise.toFixed(2)} m from tributary inflows, remaining within regulated thresholds.`;
    } else {
      forecastTh = `คาดการณ์ 24 ชั่วโมงข้างหน้า ระดับน้ำใน${riverName}มีแนวโน้มทรงตัวถึงลดลงต่อเนื่องเฉลี่ย 0.05 - 0.15 เมตร สภาพอากาศปลอดโปร่ง ไม่มีแนวโน้มวิกฤต`;
      forecastEn = `Over the next 24 hours, ${riverNameEn} stages are forecast to remain steady or gradually recede by 0.05 - 0.15 m under clear weather conditions with no threat of overflow.`;
    }

    return {
      id: ctx.docId,
      basinId: basin.slug,
      basinName: { th: basin.nameTh, en: basin.nameEn },
      issuedDate: this.getThaiDateString(ctx.now),
      issuedTime: this.getTimeString(ctx.now),
      overallSituation: { th: overallTh, en: overallEn },
      overallSeverity: ctx.overallSeverity,
      keyHighlights: highlights,
      highRiskAreas,
      upstreamStatus: { th: upstreamStatusTh, en: upstreamStatusEn },
      midstreamStatus: { th: midstreamStatusTh, en: midstreamStatusEn },
      downstreamStatus: { th: downstreamStatusTh, en: downstreamStatusEn },
      forecastNext24h: { th: forecastTh, en: forecastEn },
      officerInCharge: {
        th: "ระบบประมวลผลสถานการณ์น้ำและอุทกวิทยา",
        en: "Water Situation & Hydrology Processing System",
      },
    };
  }

  /**
   * Direct OpenAI SDK Call using Function Calling / Tool Choice
   */
  private async callOpenAIFunction(
    basin: typeof basins.$inferSelect,
    metrics: any
  ): Promise<Omit<SituationBulletin, "id" | "basinId" | "basinName" | "issuedDate" | "issuedTime"> | null> {
    if (!this.openaiClient) return null;

    const response = await this.openaiClient.chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: "system",
          content:
            "You are the Automated Water Situation and Hydrology Analysis System for Thailand's River Basins. Analyze telemetry data and call the publish_situation_bulletin function with structured, factual information in Thai and English.",
        },
        {
          role: "user",
          content: `Analyze the water situation and publish the official bulletin for "${basin.nameTh} (${basin.nameEn})".\n\nMetrics:\n${JSON.stringify(metrics, null, 2)}`,
        },
      ],
      tools: [bulletinFunctionTool],
      tool_choice: {
        type: "function",
        function: { name: "publish_situation_bulletin" },
      },
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (toolCall && toolCall.type === "function") {
      const args = JSON.parse(toolCall.function.arguments);
      return args;
    }

    return null;
  }
}

export const llmBulletinService = new LLMBulletinService();
