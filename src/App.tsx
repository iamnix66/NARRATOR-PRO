/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Content, HarmCategory, HarmBlockThreshold } from "@google/genai";
import mammoth from "mammoth";
import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { Copy, History, Loader2, RotateCcw, Sparkles, Wand2, PlusCircle, Import, X, Trash2, RefreshCcw, ChevronLeft, ChevronRight, BookOpen, PenTool, Search, LayoutList, FileText, CheckCircle2, ChevronDown, ChevronUp, Clock, PlayCircle, ListChecks, AlertCircle, Download, Save, Edit3 } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import Markdown from "react-markdown";
import { saveAs } from 'file-saver';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { RETELLING_PROTOCOL } from "./constants/protocol";
import { NARRATION_PROTOCOL, RESEARCH_PROTOCOL } from "./constants/narrator_protocols";
import { OUTLINE_PARSING_PROTOCOL, OUTLINE_REFINEMENT_PROTOCOL, OUTLINE_PLANNING_PROTOCOL, VIOLATION_DETECTION_PROTOCOL, OUTLINE_VETTING_PROTOCOL, OUTLINE_VETTING_CORRECTION_PROTOCOL } from "./constants/outliner_protocols";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const STORAGE_KEY = "absolute_reteller_session";

interface StoryPart {
  original: string;
  versions: string[];
  selectedIndex: number;
}

const NARRATOR_STORAGE_KEY = "absolute_narrator_session";

type AppMode = "retell" | "narrate" | "outlining";

interface NarrativeSection {
  id: string;
  sectionNumber?: number;
  title: string;
  timePeriod?: string;
  wordCountTarget?: number;
  primaryFocus?: string;
  startEvent?: string;
  endEvent?: string;
  narrativeBeat?: string;
  keyEvents?: string[];
  whatNotToInclude?: string[];
  
  // UI/Process fields
  description?: string;
  bullets?: string[]; // fallback
  exclusions?: string[]; // fallback
  estimatedWordCount?: number; // fallback
  originalWordCountRange?: string;
  emotionalArc?: string;
  writerNotes?: string[];
  actualWordCount?: number;
  researchBrief?: string;
  narrative?: string;
  narrativeVersions?: string[];
  selectedNarrativeIndex?: number;
}

interface SuspenseDeclaration {
  primaryType: string;
  secondaryType?: string;
  withheldInformation: string;
  revealWindow: string;
  strictExclusions: string;
}


const STORY_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

function EditableText({ value, onChange, label, className = "", multiline = false, markdown = false, customPreview }: { value: string; onChange: (v: string) => void; label: string; className?: string; multiline?: boolean; markdown?: boolean; customPreview?: React.ReactNode }) {
  const [isEditing, setIsEditing] = useState(false);
  const [temp, setTemp] = useState(value);

  if (!isEditing) {
    return (
      <div className={`group relative cursor-pointer transition-all hover:bg-black/5 rounded-xl p-2 -m-2 ${className}`} onClick={() => { setTemp(value); setIsEditing(true); }}>
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-white shadow-md rounded-full border border-warm-ink/10 text-accent z-10">
          <Edit3 className="w-3.5 h-3.5" />
        </div>
        {customPreview ? (
          customPreview
        ) : markdown ? (
           <div className="prose prose-sm max-w-none prose-warm">
             <Markdown>{value || "_Click to edit..._"}</Markdown>
           </div>
        ) : (
          <span className="block whitespace-pre-wrap">{value || "Click to add " + label.toLowerCase() + "..."}</span>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-2 p-2 -m-2 bg-accent/5 rounded-xl border border-accent/20 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-accent">{label}</span>
      </div>
      {multiline ? (
        <textarea 
          className="w-full min-h-[150px] p-4 bg-white border-2 border-accent/20 rounded-2xl outline-none focus:border-accent text-sm font-sans leading-relaxed shadow-inner"
          value={temp}
          onChange={(e) => setTemp(e.target.value)}
          autoFocus
        />
      ) : (
        <input 
          className="w-full p-2 bg-white border-2 border-accent/20 rounded-xl outline-none focus:border-accent text-sm font-sans h-10 shadow-inner"
          value={temp}
          onChange={(e) => setTemp(e.target.value)}
          autoFocus
        />
      )}
      <div className="flex gap-2 justify-end">
        <button 
          onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}
          className="px-4 py-2 text-[10px] font-bold uppercase text-warm-ink/40 hover:text-warm-ink transition-colors"
        >
          Cancel
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); onChange(temp); setIsEditing(false); }}
          className="px-4 py-2 bg-accent text-white rounded-full text-[10px] font-bold uppercase flex items-center gap-1.5 shadow-lg shadow-accent/20 transition-all hover:scale-105 active:scale-95"
        >
          <Save className="w-3.5 h-3.5" /> Save {label}
        </button>
      </div>
    </div>
  );
}

function getNormalizedEvents(section: NarrativeSection): string[] {
  const source: any = section.keyEvents || section.bullets || [];
  if (typeof source === "string") {
    return source.split("\n").map(s => s.trim()).filter(Boolean);
  }
  if (Array.isArray(source)) {
    return source.reduce<string[]>((acc, item) => {
      if (typeof item === "string") {
        const parts = item.split("\n").map(s => s.trim()).filter(Boolean);
        acc.push(...parts);
      } else if (item) {
        acc.push(String(item).trim());
      }
      return acc;
    }, []);
  }
  return [];
}

export default function App() {
  const [mode, setMode] = useState<AppMode>("retell");
  
  // Reteller State
  const [inputText, setInputText] = useState("");
  const [retoldText, setRetoldText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [storySessions, setStorySessions] = useState<StoryPart[]>([]);
  const [chatHistory, setChatHistory] = useState<Content[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isConfirmingNewStory, setIsConfirmingNewStory] = useState(false);
  const [importText, setImportText] = useState("");
  const [rewritingIndex, setRewritingIndex] = useState<number | null>(null);

  // Narrator State
  const [outlineText, setOutlineText] = useState("");
  const [outlineFile, setOutlineFile] = useState<{data: string, mimeType: string} | null>(null);
  const [sections, setSections] = useState<NarrativeSection[]>([]);
  const [outlinePlan, setOutlinePlan] = useState("");
  const [violationsAudit, setViolationsAudit] = useState("");
  const [reconstructedOutlineViolationsReport, setReconstructedOutlineViolationsReport] = useState("");
  const [suspenseDeclaration, setSuspenseDeclaration] = useState<SuspenseDeclaration | null>(null);
  const [narratorIsProcessing, setNarratorIsProcessing] = useState(false);
  const [currentNarratorStep, setCurrentNarratorStep] = useState<"idle" | "parsed" | "researched" | "planned" | "detected" | "narrating" | "refined" | "doublechecked" | "corrected">("idle");
  const [outlineSource, setOutlineSource] = useState<"scratch" | "existing" | null>(null);
  const [scratchTopic, setScratchTopic] = useState("");
  const [scratchResearchDossier, setScratchResearchDossier] = useState("");
  const [outlinerStrategy, setOutlinerStrategy] = useState<"hook" | "preserve_start" | "preserve_structure">("hook");
  const [userResearchText, setUserResearchText] = useState("");
  const [userResearchFileName, setUserResearchFileName] = useState("");
  const [userResearchSource, setUserResearchSource] = useState<"system" | "user" | "combined" | "skip">("system");
  const [userResearchFile, setUserResearchFile] = useState<{data: string, mimeType: string} | null>(null);
  const [narratorChatHistory, setNarratorChatHistory] = useState<Content[]>([]);
  const [narratingIndex, setNarratingIndex] = useState<number | null>(null);
  const [researchingIndex, setResearchingIndex] = useState<number | null>(null);
  const [collapsedResearch, setCollapsedResearch] = useState<Record<string, boolean>>({});
  
  // Rewrite Feature State
  const [isRewriteModalOpen, setIsRewriteModalOpen] = useState(false);
  const [rewriteFeedback, setRewriteFeedback] = useState("");
  const [sectionToRewriteIdx, setSectionToRewriteIdx] = useState<number | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [isEditingPlan, setIsEditingPlan] = useState(false);
  const [isEditingAudit, setIsEditingAudit] = useState(false);
  const [isEditingSuspense, setIsEditingSuspense] = useState(false);
  
  const [maxReachedStep, setMaxReachedStep] = useState<string>("idle");

  const steps = mode === "outlining" 
    ? ["idle", "parsed", "researched", "planned", "detected", "refined", "doublechecked", "corrected"]
    : ["idle", "parsed", "researched", "refined"];

  const resultRef = useRef<HTMLDivElement>(null);

  // Persistence: Load from localStorage
  useEffect(() => {
    const savedRetell = localStorage.getItem(STORAGE_KEY);
    if (savedRetell) {
      try {
        const { sessions, history } = JSON.parse(savedRetell);
        if (sessions) setStorySessions(sessions);
        if (history) setChatHistory(history);
      } catch (e) { console.error(e); }
    }

    const savedNarrate = localStorage.getItem(NARRATOR_STORAGE_KEY);
    if (savedNarrate) {
      try {
        const { sections: savedSections, step: savedStep, history, mode: savedMode, plan: savedPlan, suspense: savedSuspense, audit: savedAudit, reconstructedAudit: savedReconstructedAudit, outlineSource: savedSource, maxStep: savedMax, outlinerStrategy: savedStrategy, userResearchText: savedRText, userResearchFileName: savedRFName, userResearchSource: savedRSource, scratchResearchDossier: savedScratchResearch } = JSON.parse(savedNarrate);
        if (savedSections) setSections(savedSections);
        if (savedStep) setCurrentNarratorStep(savedStep);
        if (history) setNarratorChatHistory(history);
        if (savedMode) setMode(savedMode);
        if (savedPlan) setOutlinePlan(savedPlan);
        if (savedSuspense) setSuspenseDeclaration(savedSuspense);
        if (savedAudit) setViolationsAudit(savedAudit);
        if (savedReconstructedAudit) setReconstructedOutlineViolationsReport(savedReconstructedAudit);
        if (savedSource) setOutlineSource(savedSource);
        if (savedMax) setMaxReachedStep(savedMax);
        if (savedStrategy) setOutlinerStrategy(savedStrategy);
        if (savedRText) setUserResearchText(savedRText);
        if (savedRFName) setUserResearchFileName(savedRFName);
        if (savedRSource) setUserResearchSource(savedRSource);
        if (savedScratchResearch) setScratchResearchDossier(savedScratchResearch);
      } catch (e) { console.error(e); }
    }
  }, []);

  // Persistence: Save to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sessions: storySessions,
      history: chatHistory
    }));
  }, [storySessions, chatHistory]);

  useEffect(() => {
    localStorage.setItem(NARRATOR_STORAGE_KEY, JSON.stringify({
      sections,
      step: currentNarratorStep,
      history: narratorChatHistory,
      mode,
      plan: outlinePlan,
      suspense: suspenseDeclaration,
      audit: violationsAudit,
      reconstructedAudit: reconstructedOutlineViolationsReport,
      outlineSource,
      maxStep: maxReachedStep,
      outlinerStrategy,
      userResearchText,
      userResearchFileName,
      userResearchSource,
      scratchResearchDossier
    }));
  }, [sections, currentNarratorStep, narratorChatHistory, mode, outlinePlan, suspenseDeclaration, violationsAudit, reconstructedOutlineViolationsReport, outlineSource, maxReachedStep, outlinerStrategy, userResearchText, userResearchFileName, userResearchSource, scratchResearchDossier]);

  // --- Narrator Logic ---

  const handleParseOutline = async () => {
    if (!outlineText.trim() && !outlineFile) return;
    setNarratorIsProcessing(true);
    setError(null);
    setOutlineSource("existing");
    setMaxReachedStep("idle");

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: {
          parts: [
            ...(outlineFile ? [{ 
              inlineData: {
                data: outlineFile.data,
                mimeType: outlineFile.mimeType
              }
            }] : []),
            { text: outlineText }
          ]
        },
        config: {
          systemInstruction: OUTLINE_PARSING_PROTOCOL,
          responseMimeType: "application/json"
        }
      });
      
      const text = response.text || "[]";
      let parsed: NarrativeSection[] = [];
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        // Fallback if not an array
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }

      // Ensure it's an array (support user's parseOutline logic)
      if (!Array.isArray(parsed) && (parsed as any).sections) {
        parsed = (parsed as any).sections;
      }

      // Post-process word counts using user's regex
      const wordCountRegex = /(\[|\()?(\d+)\s*(word|words|W)\)?/i;

      parsed = parsed.map(section => {
        let parsedWordCount: number | undefined;
        
        let match = section.title.match(wordCountRegex);
        if (match && match[2]) {
          parsedWordCount = parseInt(match[2], 10);
          section.title = section.title.replace(match[0], '').trim();
        } else if (section.description) {
          match = section.description.match(wordCountRegex);
          if (match && match[2]) {
            parsedWordCount = parseInt(match[2], 10);
            section.description = section.description.replace(match[0], '').trim();
          }
        }

        return {
          ...section,
          id: section.id || `section_${Math.random().toString(36).substr(2, 9)}`,
          estimatedWordCount: parsedWordCount || section.estimatedWordCount || (section as any).targetWordCount || 500,
          bullets: section.bullets || [],
          exclusions: section.exclusions || []
        };
      });
      
      setSections(parsed);
      setCurrentNarratorStep("parsed");
      setOutlineText(text);
      confetti({ particleCount: 50, spread: 30, colors: ["#d97706"] });
    } catch (err) {
      console.error(err);
      setError("Failed to parse outline. Ensure it follows a clear section structure.");
    } finally {
      setNarratorIsProcessing(false);
    }
  };
  
  const handleGenerateDraftSections = async () => {
    if (!scratchTopic.trim()) return;
    setNarratorIsProcessing(true);
    setError(null);
    setOutlineSource("scratch");
    setMaxReachedStep("idle");

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: {
          text: `TOPIC: ${scratchTopic}

TASK: Conduct exhaustive, deeply thorough, factual, and historical research into this topic/case. Determine the exact chronological timeline, key dates, names of all real-world actors, witnesses, victims, locations, investigative steps, forensic breakthroughs, and overall outcomes.
Present a majestic, thoroughly detailed, and highly chronological Case Research Dossier of at least 1500 words. Keep any structural division purely chronological.

Do NOT generate any high-level summary or shallow list. Produce dense, extensive research outlining every factual event from earliest background setup up to final legal resolution. Provide exact testimonies, real dates, and real evidentiary notes from history.

Format your output in professional Markdown.`
        },
        config: {
          safetySettings: STORY_SAFETY_SETTINGS
        }
      });

      const text = response.text || "";
      setScratchResearchDossier(text);
      setOutlineText(text);

      const placeholderSection: NarrativeSection = {
        id: "scratch_research_placeholder",
        sectionNumber: 1,
        title: "Deep Case Research Dossier",
        timePeriod: "Complete Chronological Timeline",
        estimatedWordCount: 5000,
        bullets: [],
        exclusions: [],
        researchBrief: text
      };

      setSections([placeholderSection]);
      setCurrentNarratorStep("researched");
      setMaxReachedStep("researched");
      confetti({ particleCount: 50, spread: 30, colors: ["#d97706"] });
    } catch (err) {
      console.error(err);
      setError("Failed to generate deep research from topic.");
    } finally {
      setNarratorIsProcessing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      setNarratorIsProcessing(true);
      setError(null);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setOutlineText(prev => prev + (prev ? "\n\n" : "") + result.value);
        setOutlineFile(null); // Clear file as we've extracted text
        confetti({ particleCount: 30, spread: 20, colors: ["#d97706"] });
      } catch (err) {
        console.error(err);
        setError("Failed to extract text from Word document. Try saving as PDF or plain text.");
      } finally {
        setNarratorIsProcessing(false);
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setOutlineFile({
        data: base64.split(",")[1],
        mimeType: file.type
      });
    };
    reader.readAsDataURL(file);
  };

  const handleResearchAll = async () => {
    setNarratorIsProcessing(true);
    setError(null);

    try {
      if ((userResearchSource === "user" || userResearchSource === "combined") && !userResearchText.trim() && !userResearchFile) {
        throw new Error("Custom research document is empty. Please upload or paste your custom research first, or switch to 'Only AI (System) Research'.");
      }

      const updatedSections = [...sections];
      
      for (let i = 0; i < updatedSections.length; i++) {
        setResearchingIndex(i);
        const section = updatedSections[i];
        
        if (userResearchSource === "skip") {
          updatedSections[i] = {
            ...section,
            researchBrief: `Research skipped by author request. Subsequent narrative generation will focus directly on the original structured outline points.\n\nSection Bullets:\n${(section.bullets || []).map(b => `- ${b}`).join("\n")}`
          };
          setSections([...updatedSections]);
          continue;
        }

        let promptText = "";
        const sysInstructionText = RESEARCH_PROTOCOL;

        if (userResearchSource === "user") {
          promptText = `[FULL USER-PROVIDED RESEARCH DOCUMENT]
${userResearchText || "(Presented in the attached PDF/Document file)"}

[FULL STORY OUTLINE / TOPIC]
${outlineText}

[TARGET SECTION FOR RESEARCH EXTRACTION]
Section Title: "${section.title}"
Section Description: "${section.description || ''}"
Bullets: ${(section.bullets || []).join(", ")}

TASK: Your task is to extract, organize, and compile all pertinent names, dates, locations, character descriptions, events, backgrounds, and specific details from [FULL USER-PROVIDED RESEARCH DOCUMENT] that correspond or relate directly to the target section.
Ensure that you ONLY rely on the facts and information mentioned in [FULL USER-PROVIDED RESEARCH DOCUMENT]. Do NOT invent or make up external facts, storylines, or occurrences. Limit yourself strictly to the provided text. Provide a thorough, structured factual dossier for this specific section.`;
        } else if (userResearchSource === "combined") {
          promptText = `[FULL USER-PROVIDED RESEARCH DOCUMENT]
${userResearchText || "(Presented in the attached PDF/Document file)"}

[FULL STORY OUTLINE / TOPIC]
${outlineText}

[TARGET SECTION FOR RESEARCH EXTRACTION & COMBINATION]
Section Title: "${section.title}"
Section Description: "${section.description || ''}"
Bullets: ${(section.bullets || []).join(", ")}

TASK: You MUST extract all relevant facts, names, events, and background info from [FULL USER-PROVIDED RESEARCH DOCUMENT] that pertains to this target section. Then, using both the user's custom research AND broad, factual outline-driven details/expansion, combine and synthesize them into a single, cohesive, highly-detailed factual dossier for this section. Flawlessly preserve all exact details (e.g., dates/full names) from the user's document alongside the synthesized context.`;
        } else {
          // Default: "system"
          promptText = `[FULL STORY OUTLINE]\n${outlineText}\n\n[TARGET SECTION FOR RESEARCH]\nSection Title: "${section.title}"\nSection Description: "${section.description || ''}"\nBullets: ${(section.bullets || []).join(", ")}`;
        }

        const response = await ai.models.generateContent({
          model: "gemini-3.1-pro-preview", 
          contents: {
            parts: [
              ...(userResearchFile && (userResearchSource === "user" || userResearchSource === "combined") ? [{
                inlineData: {
                  data: userResearchFile.data,
                  mimeType: userResearchFile.mimeType
                }
              }] : []),
              { text: promptText }
            ]
          },
          config: {
            systemInstruction: sysInstructionText,
            temperature: 0.2,
            topP: 0.9,
            safetySettings: STORY_SAFETY_SETTINGS
          }
        });

        updatedSections[i] = { ...section, researchBrief: response.text || "" };
        setSections([...updatedSections]); 
      }

      setCurrentNarratorStep("researched");
      confetti({ particleCount: 100, spread: 50, colors: ["#d97706"] });
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed during research phase. Please try again.");
    } finally {
      setResearchingIndex(null);
      setNarratorIsProcessing(false);
    }
  };

  const handlePlanOutline = async (researchedSections: NarrativeSection[]) => {
    setNarratorIsProcessing(true);
    setError(null);

    const isScratch = outlineSource === "scratch";

    try {
      let prompt = "";
      let sysInst = OUTLINE_PLANNING_PROTOCOL;

      if (isScratch) {
         prompt = `CASE TOPIC: ${scratchTopic}

RESEARCH DATA:
${scratchResearchDossier}

TASK:
Based on the deep historical research, you must construct an extremely detailed structural and forensic plan to draft a chronological master outline from scratch.
The narrative complexity of the case (never its timeline duration or span of years) determines the appropriate number of sections (excluding trial/sentencing). Simple stories with a direct chronological plot (e.g., arguments, localized brawls, simple crimes of passion) require typically TWO or THREE sections. Complex stories with multiple developmental phases, plots, or schemes require three or more sections. Each section must contain AT LEAST 10 CHRONOLOGICAL BULLET POINTS/EVENTS (MINIMUM of 10, with NO upper cap/limit – let the section's historical complexity determine the maximum). There must be no shallow lists, no truncated timelines, and no general categories of activity. Each event must be a discrete action or event. We want to tell the full story without any leaks or gaps.

In this planning phase, write an extensive report answering and discussing each of the following in detail:
1. THE POINT OF DISRUPTION STARTING POINT (CRITICAL): Find and start the story exactly at the "Point of Disruption" where it first becomes clear there is a problem, which directly serves as the catalyst leading to the climax of the case. Do NOT start with family history, childhood, births, or community background. All of those things are extremely boring and kill audience retention. Explain why starting at the Point of Disruption sets up a powerful chronological progression leading path to the climax.
2. DETERMINATION OF COMPLEXITY AND SECTION COUNT (CRITICAL): Rigorously analyze the causal complexity of the story (the cause-and-effect sequence, "one thing leading to another, leading to another") from the Point of Disruption to the resolution. Explain why the narrative timeline does or does not warrant multiple sections. Choose a section count dynamically based on this complexity (typically TWO or THREE sections for simple cases, and three or more for complex cases) and write a thorough explanation justifying this choice. Indicate how many key events/bullets are planned for each section.
3. CHRONOLOGICAL MATRIX & STORY FLOW: Outline the exact narrative flow from the disruption to the climax and resolution. How will we divide the timeline chronologically across these sections? You are STRICTLY FORBIDDEN from planning or creating a separate, dedicated chapter or section for court/trial/sentencing. Fold the final outcome (how they were dealt with, went to prison, died) directly into the last 2 or 3 bullets of the final section as direct chronological history.
4. EVENT LEVEL PLANNING (AT LEAST 10 EVENTS PER SECTION, NO UPPER CAP): Discuss the key sequential events we will write into each section. Explain how we will compile at least 10 highly rich, detailed, distinct chronological occurrences per section, scaling higher if the section's historical complexity demands it, providing high-fidelity fact density with absolutely no rigid caps.
5. REASONABLE WORD COUNT TARGET: For each section, discuss and specify a reasonable, sincere word count target (e.g., 3,000 to 5,000 words per section) that matches the extreme event density.
6. OMNISCIENT PERSPECTIVE & BIAS FILTER (ZERO CELL-PING & ZERO-COURT/TRIAL CONSTRAINTS): Explain how we will ensure a 100% omniscient perspective. Identify and completely purge any default detective-focused, court/trial-focused, cell tower trace, minute-by-minute mechanical micro-action, or list redundant habits. You are strictly forbidden from mentioning, proposing, or using words like "court", "trial", "prosecution", "defense", "charged", "placed in court", "hearings", or similar. Any cell phone records, tower ping maps, or tracker operations are also 100% forbidden; plan to narrate phone calls and actions direct from history. We will have absolutely zero courtroom presence or trial scenes.
7. HOW WE PREVENT CORE PROTOCOL VIOLATIONS: Discuss how we will maintain strict adherence to:
   - Say-it-once rule (no repetition across sections/bullets).
   - No foresight/foreshadowing.
   - Grounded story events (no atmospheric commentary or emotional reactions).
   - Banning independent trial/court sections (verdict & sentence as closing bullets only).

Provide a highly professional, detailed, and structured report.`;

        sysInst = `${OUTLINE_PLANNING_PROTOCOL}\n\nYou are an expert Lead Writer, Story Architect and Narrative Forensic Expert. Your goal is to draft a clean, professional, and exhaustive forensic structural plan to write a chronological master outline from scratch based on raw historical facts. You must strictly enforce the Point of Disruption starting criteria, complexity-based dynamic section counts (typically two or three sections for simple cases, three or more for complex ones), and the absolute courtroom/trial and cell-ping bans in your planning report.`;
      } else {
        const researchData = researchedSections.map(s => `
SECTION: ${s.title}
RESEARCH DOSSIER:
\${s.researchBrief}
      `).join("\n\n---\n\n");

        prompt = `ORIGINAL OUTLINE:
${outlineText}

RESEARCH DATA:
${researchData}`;

        sysInst = outlinerStrategy === "preserve_structure"
          ? `${OUTLINE_PLANNING_PROTOCOL}\n\nCRITICAL STRATEGY OVERRIDE: STRICT STRUCTURE FIDELITY AND AUDIT
You MUST maintain exactly the same section titles, structure, order, and events of the original outline. Do NOT restructure or reposition the sections.
Your planning output must focus entirely on spotting protocol violations, testimony traps, investigator/police bias framing, and atmospheric filler inside each original section.
Your plan must detail how you will purge those violations while keeping the exact existing section sequence, story/fact density, and outline points intact.
In the PLANNING OUTPUT FORMAT section '2. THE STARTING POINT (CRITICAL)', clearly declare that we are preserving the original structure entirely, with no block repositioning, and explicitly detail how the forensic violations will be filtered out next.`
          : outlinerStrategy === "preserve_start"
            ? `${OUTLINE_PLANNING_PROTOCOL}\n\nCRITICAL STRATEGY OVERRIDE: PRESERVE-START CHRONOLOGICAL RESTRUCTURE
You MUST start the story EXACTLY where the original outline started. Do NOT change, move, or shift the starting point or entry point of the story to a later date, Discovery, or Crime hook.
From that exact original opening point, organize all subsequent chapters and events in a strict, forward-moving chronological sequence to the end.
Do NOT tell the story in the lens of investigators, courts, or witnesses. Purge all testimony traps and retroactive discovery, and report facts in the real-time order they occurred.
In the PLANNING OUTPUT FORMAT section '2. THE STARTING POINT (CRITICAL)', clearly state that we are maintaining the precise starting point of the original outline, and layout chronologically how subsequent sections/chapters will rearrange to flow chronologically from there without deleting any early/background details.`
            : OUTLINE_PLANNING_PROTOCOL;
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: { text: prompt },
        config: {
          systemInstruction: sysInst,
          safetySettings: STORY_SAFETY_SETTINGS
        }
      });

      setOutlinePlan(response.text || "No structural issues detected.");
      setCurrentNarratorStep("planned");
      confetti({ particleCount: 120, spread: 60, colors: ["#d97706"] });
    } catch (err) {
      console.error(err);
      setError("Failed to create structural plan. Please try again.");
    } finally {
      setNarratorIsProcessing(false);
    }
  };

  const handleDetectViolations = async (researchedSections: NarrativeSection[]) => {
    setNarratorIsProcessing(true);
    setError(null);

    const isScratch = outlineSource === "scratch";

    try {
      let prompt = "";
      if (isScratch) {
        prompt = `PHASE: FORENSIC INTEGRITY AUDIT & VERIFICATION
GOAL: Audit our proposed structural planning document against the Outliner Retelling Protocols and Deep Case Research to guarantee 100% structural fidelity and prevent any potential violations.

RESOURCES:
1. DEEP CASE RESEARCH:
${scratchResearchDossier}

2. STRUCTURAL PLAN:
${outlinePlan}

3. PROTOCOLS:
${RETELLING_PROTOCOL}

TASK:
Perform a rigorous verification and safety audit on the structural plan. Check for:
1. THE STARTING POINT / POINT OF DISRUPTION: Does the starting plan fail to open exactly at the chronological Point of Disruption (where things first become clear there is a problem/catalyst that leads to the climax)? Does it begin with boring childhood, family ancestry, births, or general community description details instead? If so, flag it as a major starting point violation and mandate starting exactly at the Point of Disruption, while proposing alternative natural ways to weave crucial childhood background details into later sections contextually.
2. INVESTIGATIVE DETECTIVE, COURTROOM & CELL-PING VIOLATIONS: Is there any risk that the events in any section will be narrated through the eyes of the police, courts, or witness reports instead of real-time omniscient action? Avoid words like "court", "trial", "prosecution", "defense", "charged", "placed in court", "hearings". Does the plan propose any dedicated or independent section for court, trial, sentencing, or aftermath? If so, flag it as a critical violation and direct that it be merged and the court section removed entirely, with only a 2-3 bullet outcome at the very end. Are there any plans to mention retroactive cell phone signal mapping or cellular tower pings? Flag cell records tracking as 100% banned.
3. OUTLINE PROPORTION & DEPTH: Does the plan fully guarantee that the number of sections matches the complexity of the case (with no rigid upper caps on sections), and that each section will contain at least 10 highly rich, distinct chronological events, with no artificial upper limits or rigid rules capping them if the history contains more details? Are there any shallow portions?
4. NARRATIVE REPETITION RISK (Say-it-once): Do any planned events overlap across sections or repeat facts?
5. TEMPORAL LEAPS & FLASHBACKS: Are any flashbacks or premonitions planned that break the chronological forward-moving time flow?
6. IMPLICIT VIOLATIONS / ATMOSPHERE: Are there risks of incorporating non-event filler (how characters felt, city's eerie mood, weights of vehicles or technical jargon)?

Provide a detailed, bulleted Forensic Audit and Correction directive specifying any adjustments needed to make sure the final generated outline is completely robust and 100% compliant.`;
      } else {
        const researchData = researchedSections.map(s => `
SECTION: ${s.title}
RESEARCH DOSSIER:
${s.researchBrief}
      `).join("\n\n---\n\n");

        prompt = `
PHASE: ERROR AND VIOLATION DETECTION
GOAL: Forensic audit of the ORIGINAL outline against the NEW RESEARCH and OUTLINER PROTOCOLS.

RESOURCES:
1. RESEARCH DOSSIERS:
${researchData}

2. FORENSIC PLAN:
${outlinePlan}

3. ORIGINAL OUTLINE:
${outlineText}

4. PROTOCOLS:
${RETELLING_PROTOCOL}

TASK:
Identify every single error, omission, or violation in the original outline.
You MUST analyze the story globally. Look for:
1. CROSS-SECTIONAL REPETITIONS: Information or facts mentioned in Section 1 that are repeated in later sections (Major violation).
2. FACTUAL ERRORS: Information that contradicts the research.
3. TIMELINE ERRORS: Events out of order or incorrect dates.
4. PROTOCOL VIOLATIONS: Repetition (Say-it-once), Foreshadowing (Suspense preservation), Atmospheric descriptions (Story first), Testimony traps, etc.
5. SECTION OVERLAPS: Where a section ends and the next one recaps or restates the previous one.
6. MISSING DETAILS: Crucial info from research that is absent.

OUTPUT FORMAT:
Provide a clear, bulleted forensic audit. For each violation, specify exactly what is wrong and what the correction must be in the final reconstruction. Be brutal and precise.
      `;
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: { text: prompt },
        config: {
          systemInstruction: VIOLATION_DETECTION_PROTOCOL,
          safetySettings: STORY_SAFETY_SETTINGS
        }
      });

      setViolationsAudit(response.text || "No violations detected.");
      setCurrentNarratorStep("detected");
      confetti({ particleCount: 150, spread: 70, colors: ["#ef4444", "#dc2626"] });
    } catch (err) {
      console.error(err);
      setError("Failed during violation detection phase. Please try again.");
    } finally {
      setNarratorIsProcessing(false);
    }
  };

  const handleRefineOutlineAll = async (researchedSections: NarrativeSection[]) => {
    setNarratorIsProcessing(true);
    setError(null);

    const isScratch = outlineSource === "scratch";

    try {
      let prompt = "";
      let sysInst = OUTLINE_REFINEMENT_PROTOCOL;

      if (isScratch) {
        prompt = `RESEARCH DOSSIER:
${scratchResearchDossier}

STRUCTURAL PLAN:
${outlinePlan}

FORENSIC INTEGRITY AUDIT:
${violationsAudit}

TASK:
You must now construct the final, master chronological narrative outline.
Generate a JSON object containing a "sections" array of NarrativeSections based on the Research, Plan, and Audit.

CRITICAL HARD CONSTRAINTS:
1. START EXACTLY AT THE POINT OF DISRUPTION: Section one MUST start precisely at the chronological Point of Disruption (where things first become clear there is a problem/catalyst that leads to the climax of the case). You are strictly forbidden from starting with childhood, births, parentage timelines, or town backgrounds. All of those things are extremely boring and kill audience retention. Weave any crucial prior background relations or motives naturally as brief context in later relevant action paragraphs.
2. SECTION COUNT DETERMINED BY COMPLEXITY: Decide on the appropriate number of sections (e.g., three or more) depending on the complexity of the case and the story itself. Allocate the entire chronological story timeline across these dense sections. Avoid artificial caps or limits so there are absolutely no leaks or gaps.
3. AT LEAST 10 DETAILED BULLET POINTS per section: Each section MUST contain at least 10 highly rich, detailed, sequentially ordered events in its "bullets" array. Do not truncate! Do not stop at three bullet points. There is NO upper limit or cap to prevent stiffness—let the section's historical complexity determine the maximum number of key events. If a section covers a huge chunk of time, map each key event individually.
4. NO ATMOSPHERIC NOISE, SCENERY, OR TRIVIAL PRECISION: Focus purely on objective, chronological, concrete events, actions, timeline developments, and facts. You are strictly forbidden from writing atmospheric scenery (the yellowish glow of high-pressure sodium streetlights, clear evening skies, etc.) or trivial numerical measurements with useless precision (approximately forty yards, exactly two point four seconds, carrying fifteen pounds, etc.) unless they directly and immediately caused the next plot event. 
5. STRICT OMNISCIENT VOICE & ZERO-MICRO-ACTION RULE: Present every single bullet point in an omniscient, real-time voice (action-driven). No "investigators discover", no "according to police", no testimony framing. Detail the actions as they occurred in history. You are strictly forbidden from writing bullet points about mapping cell signal coordinates or mobile phone tower retroactive trace logs. You are ALSO strictly forbidden from describing minute-by-minute micro-actions or mechanical routine operations (such as opening the door, sliding inside, inserting metal key, sparking engine, shifting transmission, etc.). Tell the story on a plot-beat level (e.g. "He entered his car and reversed" instead of describing physical muscle movements). If a detail does not affect what happens next, omit it entirely.
6. NO SENTENCE REDUNDANCY: Do not say the same thing in different words or write redundant sentences in the same bullet or section. Every single sentence must introduce a new, active chronological event or plot progression. 
7. EVERY date and number MUST be written in full words (e.g., 'the tenth of october nineteen ninety six', 'five hundred thousand dollars', etc.). No digits allowed!
8. NO SHALLOW OR ONE-SENTENCE BULLETS: Every bullet/event in the JSON MUST be extremely rich, deep, and detailed. Do NOT write simple "academic facts" or single sentences. Each key event must be a multi-sentence paragraph (at least 3-5 sentences long, around 60 to 120 words) that connects seamlessly from the preceding events. It should convey a complete, gripping, immersive story picture that can be understood thoroughly on its own.
9. ZERO COURT OR TRIAL TERM PRESENCE (100% FORBIDDEN IN ALL BULLETS): You are strictly forbidden from creating a dedicated or separate section, or writing any bullet points, containing words or details relating to courts, trials, jury selection, judges, lawyers, prosecutors, legal hearings, indictments, charges, or legal testimonies. Banish all trial drama and courtroom vocabulary (such as 'charged', 'placed in court', 'prosecutor', 'defense case') entirely. The final outcome of how the characters were dealt with (e.g. went to prison, died, what happened to them) must be written purely as direct chronological historical facts folded exclusively into the last 2 or 3 bullet points of the final section. The story concludes there.
10. STRICTOR CORE COMPLIANCE WITH FORENSIC AUDIT: You must review the FORENSIC INTEGRITY AUDIT report closely and actively correct every single violation flagged. You are strictly forbidden from ignoring the audit's findings or repeating the flagged errors in the final outline. All identified violations must be fully resolved.

Example of the exact depth, tone, and prose style needed for EVERY single bullet point:
- "After the nineteen ninety one acquittal, Nash's criminal operation continues at a reduced but steady pace. His nightclub empire has contracted under years of legal pressure, but the drug network persists. A cooperative federal and local investigation begins around nineteen ninety six, pooling intelligence from multiple agencies and focusing on Nash's drug trafficking and money laundering operations as the entry point."
- "Investigators working the case develop a source with knowledge of the first trial. The source leads them to the holdout juror — a young woman who, during the original murder trial, had received a payment of fifty thousand dollars from intermediaries connected to Nash. The payment was made in exchange for a vote to acquit. Eleven jurors had voted to convict. She had stood alone, immovable, and forced the mistrial. The source's account is corroborated. Nash had not escaped justice through insufficient evidence in that first trial. He had purchased the outcome."

Ensure ALL generated outline sections comply 100% with this style of highly immersive, ultra-detailed chronological events. No short bullet items are allowed. Keep word count target high (e.g., 5000 to 7000 words per section) to match this depth.

Return the JSON block exactly matching this JSON schema:
{
  "suspenseTypeDeclaration": {
    "primaryType": "IDENTITY-UNKNOWN | MOTIVE-UNKNOWN | MECHANISM | FALSE-NARRATIVE",
    "secondaryType": "optional",
    "withheldInformation": "description of strategically withheld facts to protect suspense",
    "revealWindow": "section ids",
    "strictExclusions": "what must not appear"
  },
  "sections": [
    {
      "sectionNumber": 1,
      "title": "Section Title",
      "timePeriod": "e.g. June nineteen eighty six to July nineteen eighty six in words",
      "wordCountTarget": 5000,
      "primaryFocus": "The single sentence goal of this chronological phase",
      "startEvent": "The opening historical action in words",
      "endEvent": "The closing action in words",
      "narrativeBeat": "e.g. Setup",
      "bullets": [
        "First chronological event, written in full words without digits, multi-sentence action sequence...",
        "Second event, highly detailed...",
        "..." (Ensure at least 10 sequential, detailed bullet points are generated per section. There is no upper limit/cap—generate as many as needed to fully capture the section's historical complexity)
      ],
      "whatNotToInclude": [
        "Exclusions to prevent double narration or keep suspense"
      ]
    }
  ]
}
`;
        sysInst = `${OUTLINE_REFINEMENT_PROTOCOL}\n\nCRITICAL STRATEGY OVERRIDE: START FROM SCRATCH MASTER CHRONOLOGICAL OUTLINE GENERATION
You are generating a completely new outline from raw research facts.
You MUST output the appropriate number of sections matching the complexity of the case and the story itself, with at least 10 detailed chronological action bullet points in each section (with no upper limit or cap—the section's chronological complexity determines the maximum number of events) to prevent redundancies, focus on real events, and maintain maximum depth per event. No summarization. Complete timelines only. You are STRICTLY FORBIDDEN from creating a separate or dedicated section for court/trial/sentencing. Fold verdict and sentence directly and solely into the final 2 or 3 bullet points of the very last section.`;
      } else {
        const researchData = researchedSections.map(s => `
SECTION: ${s.title}
RESEARCH DOSSIER:
${s.researchBrief}
      `).join("\n\n---\n\n");

        prompt = `
GOAL: High-fidelity narrative reconstruction. Take the ORIGINAL outline and the FORENSIC AUDIT and merge them into the final structured outline.

CRITICAL FIDELITY MANDATE:
1. NO SUMMARIZATION: You are forbidden from summarizing the original outline. If Section 1 of the original outline has 30 detailed bullet points, the refined version MUST have at least 30 detailed bullet points.
2. MAINTAIN ALL DEPTH: If a bullet in the original outline consists of 4-5 sentences, you MUST carry over all those sentences. Do NOT shorten them.
3. ONLY REMOVE VIOLATIONS: The ONLY items you are allowed to remove or change are those explicitly flagged in the VIOLATION & ERROR AUDIT. Everything else must be preserved in its full original density.
4. WORD COUNT SINCERITY: Ensure the "targetWordCount" for each section reflects the actual density of the provided events.

ORIGINAL OUTLINE:
${outlineText}

RESEARCH DATA:
${researchData}

INTERNAL STRUCTURAL PLAN:
${outlinePlan}

VIOLATION & ERROR AUDIT:
${violationsAudit}
        `;

        sysInst = (outlinerStrategy === "preserve_structure"
          ? `${OUTLINE_REFINEMENT_PROTOCOL}\n\nCRITICAL STRATEGY OVERRIDE: STRICT STRUCTURE AND EVENT LEVEL FIDELITY
You MUST preserve the EXACT section arrangement, sequence, titles, and event details of the original outline. You are strictly FORBIDDEN from rearranging, repositioning, or combining sections or shifting events across different sections.
Your ONLY task in the reconstruction is to:
1. Spot and aggressively correct all protocol violations, including testimony traps, investigator/witness framing bias, and atmospheric fluff. If an event is written from an investigator's perspective or witness perspective, rewrite it into real-time omniscient action without altering the underlying fact or event detail.
2. If a section has 20 events, keep all 20 events. If each event has rich details, maintain them fully, unless the detail is pure atmospheric fluff or a protocol violation.
Ensure that the final output maintains 100% section-by-section structural alignment with the original outline.`
          : outlinerStrategy === "preserve_start"
            ? `${OUTLINE_REFINEMENT_PROTOCOL}\n\nCRITICAL STRATEGY OVERRIDE: PRESERVE-START NARRATIVE RECONSTRUCTION
You MUST start the refined story outline EXACTLY where the original outline started. Do NOT shift the opening of the story to a later crime hook or skip early sections/setup.
From that original started point, organize and chronologicalize all subsequent sections/chapters.
Do NOT tell any part of the story through police/investigator/witness/court perspective framing. Ensure the facts are narrated directly as they happened in real-time. Preserve all detail, depth, and density from the original outline without summary.`
            : OUTLINE_REFINEMENT_PROTOCOL) + "\n\nCRITICAL DATE RULE: You MUST write out all dates in full words. No digits for days or years. (e.g., 'the second of march, twenty twenty three').\n\nCRITICAL QUALITY RULE: DO NOT SUMMARIZE OR SHORTEN ANY KEY EVENTS. Every bullet/event in the output JSON MUST be extremely rich and detailed (at least 3-5 sentences, 60-120 words per bullet point) as per the OUTLINE_REFINEMENT_PROTOCOL. Single-sentence bullet points are strictly forbidden and make the output useless.";
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: { text: prompt },
        config: {
          systemInstruction: sysInst,
          responseMimeType: "application/json",
          safetySettings: STORY_SAFETY_SETTINGS
        }
      });

      const text = response.text || "{}";
      let parsed: any = {};
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        const jsonMatch = text.match(/\{[\s\S]*\}/) || text.match(/\[[\s\S]*\]/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }

      if (parsed.suspenseTypeDeclaration) {
        setSuspenseDeclaration(parsed.suspenseTypeDeclaration);
      }

      let refined: NarrativeSection[] = [];
      if (parsed.sections && Array.isArray(parsed.sections)) {
        refined = parsed.sections;
      } else if (Array.isArray(parsed)) {
        refined = parsed;
      }

      // Match of original research brief to refined sections
      refined = refined.map((section, idx) => {
        let matchedBrief = "";
        if (!isScratch && researchedSections && researchedSections.length > 0) {
          const titleWords = section.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          let bestScore = -1;
          let bestIndex = -1;
          
          researchedSections.forEach((origSec, oIdx) => {
            if (origSec.researchBrief) {
              let score = 0;
              if (origSec.title.toLowerCase() === section.title.toLowerCase()) {
                score += 100;
              }
              titleWords.forEach(word => {
                if (origSec.title.toLowerCase().includes(word)) {
                  score += 10;
                }
              });
              if (score > bestScore) {
                bestScore = score;
                bestIndex = oIdx;
              }
            }
          });
          
          if (bestIndex !== -1 && bestScore > 0) {
            matchedBrief = researchedSections[bestIndex].researchBrief || "";
          } else if (researchedSections[idx]?.researchBrief) {
            matchedBrief = researchedSections[idx].researchBrief || "";
          } else {
            matchedBrief = researchedSections.map(s => s.researchBrief).filter(Boolean).join("\n\n");
          }
        }

        return {
          ...section,
          id: section.id || `refined_${idx}_${Math.random().toString(36).substr(2, 9)}`,
          estimatedWordCount: section.estimatedWordCount || (section as any).targetWordCount || section.wordCountTarget || 5000,
          bullets: section.bullets || (section as any).keyEvents || [],
          exclusions: section.exclusions || (section as any).whatNotToInclude || [],
          researchBrief: isScratch ? scratchResearchDossier : (matchedBrief || "")
        };
      });

      setSections(refined);
      setCurrentNarratorStep("refined");
      confetti({ particleCount: 150, spread: 70, colors: ["#d97706"] });
    } catch (err) {
      console.error(err);
      setError("Failed to refine the outline. The research was successful, but the final rewrite failed.");
    } finally {
      setNarratorIsProcessing(false);
    }
  };

  const handleCheckOutlineViolations = async (currentSections: NarrativeSection[]) => {
    setNarratorIsProcessing(true);
    setError(null);

    try {
      const outlineRepresentation = currentSections.map(s => `
SECTION ${s.sectionNumber || s.id}: ${s.title}
TIME PERIOD: ${s.timePeriod || 'N/A'}
PRIMARY FOCUS: ${s.primaryFocus || 'N/A'}
KEY EVENT BULLETS:
${getNormalizedEvents(s).map((b, bIdx) => `  ${bIdx + 1}. ${b}`).join("\n")}
`).join("\n\n---\n\n");

      const prompt = `PHASE: ULTRA-STRICT RECONSTRUCTED OUTLINE VETTING
GOAL: Audit every single bullet point in the reconstructed narrative outline against Outliner Retelling Protocols to identify subtle foreshadowing, psychological telegraphing, police/court/trial leakage, digit use, and other violations.

OUTLINE UNDER AUDIT:
${outlineRepresentation}

PROTOCOLS & VETTING INSTRUCTIONS:
${OUTLINE_VETTING_PROTOCOL}

TASK:
Perform a relentless, bullet-by-bullet audit. Highlight all violations and list the exact text and explain why it's a violation. Offer corrected versions of the exact sentences. Be extremely direct and honest.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: { text: prompt },
        config: {
          systemInstruction: OUTLINE_VETTING_PROTOCOL,
          safetySettings: STORY_SAFETY_SETTINGS
        }
      });

      setReconstructedOutlineViolationsReport(response.text || "No reconstructed outline violations detected.");
      setCurrentNarratorStep("doublechecked");
      confetti({ particleCount: 150, spread: 70, colors: ["#ef4444", "#dc2626"] });
    } catch (err) {
      console.error(err);
      setError("Failed to audit reconstructed outline. Please try again.");
    } finally {
      setNarratorIsProcessing(false);
    }
  };

  const handleCorrectOutlineViolations = async (currentSections: NarrativeSection[]) => {
    setNarratorIsProcessing(true);
    setError(null);

    try {
      const outlineRepresentation = currentSections.map(s => `
SECTION ${s.sectionNumber || s.id}: ${s.title}
TIME PERIOD: ${s.timePeriod || 'N/A'}
PRIMARY FOCUS: ${s.primaryFocus || 'N/A'}
KEY EVENT BULLETS:
${getNormalizedEvents(s).map((b, bIdx) => `  ${bIdx + 1}. ${b}`).join("\n")}
`).join("\n\n---\n\n");

      const prompt = `GOAL: Sincere precision alignment. Purge all detected violations from the reconstructed outline while retaining full depth and narrative story elements.

RECONSTRUCTED OUTLINE:
${outlineRepresentation}

DETAILED VETTING REPORT & ACTION PLAN:
${reconstructedOutlineViolationsReport}

TASK:
You must correct and rewrite the outline sections based on the vetting report and standard Outliner Retelling Protocols.
For each section, look at the identified violations, rewrite those specific sentences/bullets to remove foreshadowing, psychological telegraphing, investigative framing, digits, and courtroom terms.
DO NOT shorten, summarize, or compress other bullet points. Keep their extreme detail and rich descriptions intact (60-120 words per bullet point, multiple sentences).
DO NOT delete non-violating bullet points. Maintain the exact sequence and narrative depth. Only clean up target violations.

Return a JSON block exactly matching this schema:
{
  "suspenseTypeDeclaration": {
    "primaryType": "IDENTITY-UNKNOWN | MOTIVE-UNKNOWN | MECHANISM | FALSE-NARRATIVE",
    "secondaryType": "optional",
    "withheldInformation": "description",
    "revealWindow": "section ids",
    "strictExclusions": "what must not appear"
  },
  "sections": [
    {
      "id": "slug",
      "sectionNumber": 1,
      "title": "Title",
      "timePeriod": "Date/Range",
      "wordCountTarget": 500,
      "primaryFocus": "Single sentence function",
      "startEvent": "Exact moment it begins",
      "endEvent": "Exact moment it ends",
      "narrativeBeat": "e.g. The Setup",
      "bullets": ["Detail-rich, multi-sentence narrative action with all violations carefully corrected and purged, retaining all depth and facts"],
      "whatNotToInclude": ["Strict exclusions to protect suspense"]
    }
  ]
}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: { text: prompt },
        config: {
          systemInstruction: OUTLINE_VETTING_CORRECTION_PROTOCOL,
          responseMimeType: "application/json",
          safetySettings: STORY_SAFETY_SETTINGS
        }
      });

      const text = response.text || "{}";
      let parsed: any = {};
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        const jsonMatch = text.match(/\{[\s\S]*\}/) || text.match(/\[[\s\S]*\]/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }

      if (parsed.suspenseTypeDeclaration) {
        setSuspenseDeclaration(parsed.suspenseTypeDeclaration);
      }

      let corrected: NarrativeSection[] = [];
      if (parsed.sections && Array.isArray(parsed.sections)) {
        corrected = parsed.sections;
      } else if (Array.isArray(parsed)) {
        corrected = parsed;
      }

      // Preserve research brief and update sections
      corrected = corrected.map((sec, idx) => {
        const matchingOrigSec: any = currentSections[idx] || currentSections.find(s => s.sectionNumber === sec.sectionNumber) || {};
        return {
          ...sec,
          id: sec.id || matchingOrigSec.id || `corrected_${idx}_${Math.random().toString(36).substr(2, 9)}`,
          estimatedWordCount: sec.estimatedWordCount || sec.wordCountTarget || matchingOrigSec.estimatedWordCount || 5000,
          bullets: sec.bullets || (sec as any).keyEvents || [],
          exclusions: sec.exclusions || (sec as any).whatNotToInclude || [],
          researchBrief: matchingOrigSec.researchBrief || scratchResearchDossier || ""
        };
      });

      setSections(corrected);
      setCurrentNarratorStep("corrected");
      confetti({ particleCount: 200, spread: 80, colors: ["#10b981"] });
    } catch (err) {
      console.error(err);
      setError("Failed to apply corrections to reconstructed outline. Please try again.");
    } finally {
      setNarratorIsProcessing(false);
    }
  };

  const handleNarrateSection = async (index: number) => {
    const section = sections[index];
    if (!section || !section.researchBrief) return;

    setNarratingIndex(index);
    setError(null);

    try {
      const normalizedEvents = getNormalizedEvents(section);
      const exclusions = section.exclusions || section.whatNotToInclude || [];
      const targetWordCount = section.wordCountTarget || section.estimatedWordCount || 5000;

      const prompt = `
        You are an expert historian, master dramatist, and literary narrator writing Chapter ${index + 1} of a comprehensive historical story chronicle.
        
        CHAPTER TITLE: "${section.title}"
        TIME PERIOD COVERED: "${section.timePeriod || 'Not specified'}"
        PRIMARY INTENT & FOCUS: "${section.primaryFocus || 'None specified'}"
        STARTING EVENT: "${section.startEvent || 'None specified'}"
        ENDING EVENT: "${section.endEvent || 'None specified'}"
        NARRATIVE BEAT STYLE: "${section.narrativeBeat || 'Detailed setup and dramatic unfolding'}"
        
        CHRONOLOGICAL KEY EVENTS / DEVELOPMENTS TO NARRATE (YOU MUST DETAIL-NARRATE EVERY SINGLE POINT IN ORDER):
        ${normalizedEvents.map((ev, i) => `[Event ${i + 1}] ${ev}`).join("\n")}
        
        CRITICAL SUSPENSE EXCLUSIONS (DO NOT EXPOSE OR DISCUSS THESE):
        ${exclusions.length > 0 ? exclusions.map((ex, i) => `- ${ex}`).join("\n") : "None."}
        
        DEDICATED HISTORICAL RESEARCH DOSSIER / HISTORICAL TRUTHS FOR DETAILS:
        ${section.researchBrief}
        
        TARGET DENSITY & WORD COUNT:
        - You MUST produce a fully-fleshed, deeply engaging narrative text of AT LEAST ${targetWordCount} words (e.g., target ${targetWordCount} - ${targetWordCount + 500} words).
        - Expand every chronological event into multiple immersive, multi-sentence paragraphs with active human descriptions, dialogue, scenes, and thoughts.
        - NEVER summarize. Do not skip or speed through any events. Ensure the narrative flows continuously.
        
        CRITICAL RECONSTRUCTION PROTOCOLS (VIOLATION PREVENTIONS):
        1. ZERO COURT OR TRIAL SCENES: You are strictly forbidden from writing about courtroom proceedings, judges, juries, legal defense, prosecution, trials, legal testimonies, depositions, or legal sentencing. Fold any final justice outcomes solely and direct as a simple chronological result at the very end.
        2. ZERO PHONE RECORD INTERRUPTIONS / CELL TOWERS: Do not write about investigators checking cell phone mapping, cell tower pings, pulling phone records, or technical mobile location tracking. Describe what calls were made and character movements purely as direct, real-time actions of the characters.
        3. FOCUS ON THE HEART OF THE STORY: Focus entirely on the characters' motivations, relationship dynamics, actions, and the emotional/physical developments of the events. Avoid dry technical descriptions, machine weights, or clinical statistics.
        4. PERFECT FULL-WORD DATES: Every single date, year, caliber, room number, and currency MUST be spelled out completely in words (e.g. "the fifth of March, nineteen ninety six", "eighty thousand dollars"). Never use numeric digits.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview", 
        contents: { text: prompt },
        config: {
          systemInstruction: NARRATION_PROTOCOL + "\n\nCRITICAL DATE RULE: You MUST write out all dates in full words. No digits for days or years. (e.g., 'the second of March, twenty twenty three').\n\nFLESH OUT MANDATE: Do NOT just repeat the outline. Use the research to build real, engaging scenes. If you just mirror the outline bullet points, you have failed.",
          temperature: 0.9, 
          topP: 0.95,
          safetySettings: STORY_SAFETY_SETTINGS
        }
      });

      const result = response.text || "";
      const actualCount = wordCount(result);

      setSections(prev => {
        const next = [...prev];
        const narrative = result;
        const versions = [narrative];
        next[index] = { 
          ...next[index], 
          narrative: narrative,
          narrativeVersions: versions,
          selectedNarrativeIndex: 0,
          actualWordCount: actualCount
        };
        return next;
      });

      setNarratorChatHistory([
        ...narratorChatHistory,
        { role: "user", parts: [{ text: `Narrate section: ${section.title}` }] },
        { role: "model", parts: [{ text: result }] },
      ]);

      if (index === sections.length - 1) {
        setCurrentNarratorStep("narrating");
      }

      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#d97706']
      });

    } catch (err) {
      console.error(err);
      setError("Failed to narrate this section. Please try again.");
    } finally {
      setNarratingIndex(null);
    }
  };

  const totalEstimatedWords = sections.reduce((acc, s) => acc + (s.estimatedWordCount || 0), 0);
  const totalActualWords = sections.reduce((acc, s) => acc + (s.actualWordCount || 0), 0);

  const getOutlineSectionWordCount = (section: NarrativeSection): number => {
    let count = 0;
    const cw = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
    
    if (section.title) count += cw(section.title);
    if (section.timePeriod) count += cw(section.timePeriod);
    if (section.narrativeBeat) count += cw(section.narrativeBeat);
    if (section.primaryFocus) count += cw(section.primaryFocus);
    if (section.startEvent) count += cw(section.startEvent);
    if (section.endEvent) count += cw(section.endEvent);
    
    const events = getNormalizedEvents(section);
    events.forEach(e => {
      if (e) count += cw(e);
    });
    
    const exclusions = section.whatNotToInclude || section.exclusions || [];
    exclusions.forEach(ex => {
      if (ex) count += cw(ex);
    });
    
    return count;
  };

  const getOutlineSectionKeyEventsWordCount = (section: NarrativeSection): number => {
    let count = 0;
    const cw = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
    const events = getNormalizedEvents(section);
    events.forEach(e => {
      if (e) count += cw(e);
    });
    return count;
  };

  const totalOutlineWords = sections.reduce((acc, s) => acc + getOutlineSectionWordCount(s), 0);

   const updateSection = (id: string, updates: Partial<NarrativeSection>) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const handleRewriteNarrativeClick = (index: number) => {
    setSectionToRewriteIdx(index);
    setRewriteFeedback("");
    setIsRewriteModalOpen(true);
  };

  const executeRewriteNarrative = async () => {
    if (sectionToRewriteIdx === null) return;
    const index = sectionToRewriteIdx;
    const section = sections[index];
    if (!section) return;

    setIsRewriteModalOpen(false);
    setNarratingIndex(index);
    setError(null);

    try {
      const currentText = section.narrativeVersions && section.selectedNarrativeIndex !== undefined 
        ? section.narrativeVersions[section.selectedNarrativeIndex] 
        : section.narrative;

      const prompt = `
        SECTION: ${section.title}
        RESEARCH: ${section.researchBrief}
        PLANNING: ${outlinePlan}
        
        PREVIOUS VERSION:
        ${currentText}
        
        FEEDBACK/PROBLEM WITH PREVIOUS VERSION:
        ${rewriteFeedback || "Make it better following all protocols."}
        
        TASK: Rewrite this section. Maintain the depth and density of the original outline. Ensure dates are in words.
        
        TOTAL DISRUPTION MANDATE: You MUST destroy the original sentence and structure. If you just swap words, you have failed. Maintain the exact sequence of events as they appear in the original text but use simple spoken words.

        CRITICAL RECONSTRUCTION PROTOCOLS (VIOLATION PREVENTIONS):
        1. ZERO COURT OR TRIAL SCENES: You are strictly forbidden from writing about courtroom proceedings, judges, juries, legal defense, prosecution, trials, legal testimonies, depositions, or legal sentencing. Fold any final justice outcomes solely and direct as a simple chronological result at the very end.
        2. ZERO PHONE RECORD INTERRUPTIONS / CELL TOWERS: Do not write about investigators checking cell phone mapping, cell tower pings, pulling phone records, or technical mobile location tracking. Describe what calls were made and character movements purely as direct, real-time actions of the characters.
        3. FOCUS ON THE HEART OF THE STORY: Focus entirely on the characters' motivations, relationship dynamics, actions, and the emotional/physical developments of the events. Avoid dry technical descriptions, machine weights, or clinical statistics.
        4. PERFECT FULL-WORD DATES: Every single date, year, caliber, room number, and currency MUST be spelled out completely in words. Never use numeric digits.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: { text: prompt },
        config: {
          systemInstruction: NARRATION_PROTOCOL + "\n\nCRITICAL DATE RULE: You MUST write out all dates in full words. No digits for days or years. (e.g., 'the second of March, twenty twenty three').\n\nFLESH OUT MANDATE: Do NOT just repeat the outline. Use the research to build real, engaging scenes. Also, apply zero-court, zero-cell-ping, and story-heart focus rules strictly.",
          temperature: 0.8,
          safetySettings: STORY_SAFETY_SETTINGS
        }
      });

      const result = response.text || "";
      const actualCount = wordCount(result);

      setSections(prev => {
        const next = [...prev];
        const s = next[index];
        const versions = [...(s.narrativeVersions || []), result];
        next[index] = {
          ...s,
          narrative: result, // current view
          narrativeVersions: versions,
          selectedNarrativeIndex: versions.length - 1,
          actualWordCount: actualCount
        };
        return next;
      });

      confetti({
        particleCount: 40,
        spread: 40,
        origin: { y: 0.7 },
      });
    } catch (err) {
      console.error(err);
      setError("Failed to rewrite section. Please try again.");
    } finally {
      setNarratingIndex(null);
      setSectionToRewriteIdx(null);
    }
  };

  const handleSelectNarrativeVersion = (sectionId: string, versionIdx: number) => {
    setSections(prev => prev.map(s => {
      if (s.id === sectionId && s.narrativeVersions) {
        const selectedText = s.narrativeVersions[versionIdx];
        return {
          ...s,
          selectedNarrativeIndex: versionIdx,
          narrative: selectedText,
          actualWordCount: wordCount(selectedText)
        };
      }
      return s;
    }));
  };

  useEffect(() => {
    const stepIdx = steps.indexOf(currentNarratorStep);
    const maxIdx = steps.indexOf(maxReachedStep);
    if (stepIdx > maxIdx) {
      setMaxReachedStep(currentNarratorStep);
    }
  }, [currentNarratorStep, steps, maxReachedStep]);

  const goToStep = (step: any) => {
    if (steps.indexOf(step) <= steps.indexOf(maxReachedStep)) {
      setCurrentNarratorStep(step);
    }
  };

  const goBack = () => {
    const currentIndex = steps.indexOf(currentNarratorStep);
    if (currentIndex > 0) {
      setCurrentNarratorStep(steps[currentIndex - 1] as any);
    } else if (currentNarratorStep === "idle") {
      setOutlineSource(null);
    }
  };

  const goForward = () => {
    const currentIndex = steps.indexOf(currentNarratorStep);
    if (currentIndex < steps.length - 1 && steps.indexOf(steps[currentIndex + 1]) <= steps.indexOf(maxReachedStep)) {
      setCurrentNarratorStep(steps[currentIndex + 1] as any);
    }
  };

  const downloadAsDocx = async () => {
    let docChildren: any[] = [];

    if (mode === "retell") {
      // Retell Mode: A seamless narrative document
      docChildren = [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: "RETELLING NARRATIVE",
              bold: true,
              size: 32,
              font: "Georgia",
            }),
          ],
        }),
        new Paragraph({ text: "" }),
        ...storySessions.flatMap((session, index) => [
          new Paragraph({
            children: [
              new TextRun({ 
                text: `PART ${index + 1}`, 
                bold: true, 
                size: 20,
                color: "1e293b",
                underline: { type: BorderStyle.SINGLE }
              }),
            ],
          }),
          new Paragraph({ text: "" }),
          ...session.versions[session.selectedIndex].split("\n").filter(l => l.trim()).map(line => 
            new Paragraph({
              text: line.trim(),
              spacing: { after: 200 },
              alignment: AlignmentType.JUSTIFIED
            })
          ),
          new Paragraph({ text: "" }),
        ])
      ];
    } else if (mode === "narrate") {
      // Narrate Mode: A full book-style document
      docChildren = [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: "FULL NARRATION: " + (sections[0]?.title || "STORY"),
              bold: true,
              size: 32,
              font: "Georgia",
            }),
          ],
        }),
        new Paragraph({ text: "" }),
        ...sections.filter(s => s.narrative).flatMap((section, index) => [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ 
                text: `CHAPTER ${index + 1}: ${section.title.toUpperCase()}`, 
                bold: true, 
                size: 24,
                font: "Georgia"
              }),
            ],
          }),
          new Paragraph({ text: "" }),
          ...section.narrative!.split("\n").filter(l => l.trim()).map(line => 
            new Paragraph({
              text: line.trim(),
              spacing: { after: 200, line: 360 }, // 1.5 line spacing
              alignment: AlignmentType.JUSTIFIED,
              indent: { firstLine: 450 } // Standard paragraph indentation
            })
          ),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "" }),
        ])
      ];
    } else {
      // Outlining Mode: Technical structural breakdown
      docChildren = [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: "TECHNICAL STORY OUTLINE: " + (sections[0]?.title || "NARRATIVE"),
              bold: true,
              size: 32,
              font: "Georgia",
            }),
          ],
        }),
        new Paragraph({ text: "" }),
        
        // Suspense Declaration
        ...(suspenseDeclaration ? [
          new Paragraph({
            shading: { fill: "f3e8ff" },
            children: [
              new TextRun({
                text: " SUSPENSE STRATEGY ",
                bold: true,
                size: 24,
                color: "581c87",
              }),
            ],
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            children: [
              new TextRun({ text: "Primary Type: ", bold: true }),
              new TextRun({ text: suspenseDeclaration.primaryType }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Withheld Information: ", bold: true }),
              new TextRun({ text: suspenseDeclaration.withheldInformation }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Reveal Window: ", bold: true }),
              new TextRun({ text: suspenseDeclaration.revealWindow }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Strict Exclusions: ", bold: true }),
              new TextRun({ text: suspenseDeclaration.strictExclusions, italics: true, color: "6b21a8" }),
            ],
          }),
          new Paragraph({ text: "" }),
        ] : []),

        // Sections
        ...sections.flatMap((section, index) => [
          new Paragraph({
            shading: { fill: "f8fafc" },
            border: {
              top: { color: "e2e8f0", size: 1, style: BorderStyle.SINGLE },
              bottom: { color: "e2e8f0", size: 1, style: BorderStyle.SINGLE },
            },
            children: [
              new TextRun({ 
                text: ` SECTION ${section.sectionNumber || index + 1}: ${section.title.toUpperCase()} `, 
                bold: true, 
                size: 24,
                color: "1e293b" 
              }),
            ],
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            children: [
              new TextRun({ text: "Time Period: ", bold: true }),
              new TextRun({ text: section.timePeriod || "---" }),
              new TextRun({ text: "    |    ", color: "94a3b8" }),
              new TextRun({ text: "Word Count Target: ", bold: true }),
              new TextRun({ text: String(section.wordCountTarget || section.estimatedWordCount || 500) + " words" }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Narrative Beat: ", bold: true }),
              new TextRun({ text: section.narrativeBeat || "---" }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Primary Focus: ", bold: true }),
              new TextRun({ text: section.primaryFocus || "---", italics: true }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Start Event: ", bold: true, color: "166534" }),
              new TextRun({ text: section.startEvent || "---" }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "End Event: ", bold: true, color: "991b1b" }),
              new TextRun({ text: section.endEvent || "---" }),
            ],
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            children: [new TextRun({ text: "CORE NARRATIVE BEATS", bold: true, size: 20, underline: {} })],
          }),
          ...(section.keyEvents || section.bullets || []).map((bullet, bIdx) => 
            new Paragraph({
              text: `${bIdx + 1}. ${bullet}`,
              indent: { left: 720 },
            })
          ),
          new Paragraph({ text: "" }),
          new Paragraph({
            children: [new TextRun({ text: "SUSPENSE EXCLUSIONS", bold: true, size: 20, color: "991b1b" })],
          }),
          ...(section.whatNotToInclude || section.exclusions || []).map(ex => 
            new Paragraph({
              indent: { left: 720 },
              children: [new TextRun({ text: `× ${ex}`, italics: true, color: "991b1b" })]
            })
          ),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "" }),
        ]),
      ];
    }

    const doc = new Document({
      sections: [{ properties: {}, children: docChildren }],
    });

    const blob = await Packer.toBlob(doc);

    // Generate a short, realistic filename based on the content/topic/main character
    let contentName = "";
    
    // Construct the overall story context to let Gemini find the central focus or main character
    let storyContextText = "";
    if (mode === "retell") {
      storyContextText = storySessions
        .map((session, index) => {
          const selected = session.versions[session.selectedIndex] || "";
          return `PART ${index + 1}:\n${selected}`;
        })
        .join("\n\n");
    } else {
      storyContextText = sections
        .map((section, index) => {
          const narration = section.narrative || "";
          const bullets = (section.bullets || []).join("\n");
          return `SECTION ${index + 1}: ${section.title}\nBullets:\n${bullets}\nNarration:\n${narration}`;
        })
        .join("\n\n");
    }

    if (scratchTopic) {
      storyContextText = `Topic: ${scratchTopic}\n\n` + storyContextText;
    }

    // Attempt intelligent analysis via fast Gemini model first
    if (storyContextText.trim().length > 30) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Analyze the following story content or outline. Determine what the entire story is about, who the main character is, or what the central case/topic is. 
Generate a very short, clean and realistic filename (1 to 4 words). 
Prefer the main character's name (e.g. "Rhodes Cowle") or the primary case topic (e.g. "Dansoman Ritual Killings"). 
Do NOT include the file extension, do NOT use quote marks in the output, and do NOT write any conversational or preachy commentary. Return ONLY the plain words.

STORY DETAILS:
${storyContextText.substring(0, 12000)}`
                }
              ]
            }
          ]
        });
        if (response && response.text) {
          const parsedName = response.text.trim().replace(/^['"]|['"]$/g, "");
          if (parsedName && parsedName.length > 2 && parsedName.length < 100) {
            contentName = parsedName;
          }
        }
      } catch (e) {
        console.error("Failed to extract name with Gemini, using fallback:", e);
      }
    }

    // Fallback if Gemini failed or content was too short
    if (!contentName) {
      if (mode === "retell") {
        if (storySessions.length > 0) {
          const firstVersion = storySessions[0].versions[storySessions[0].selectedIndex] || "";
          const lines = firstVersion.split("\n").map(l => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            contentName = lines[0].split(/\s+/).slice(0, 5).join(" ");
          } else {
            const originalLines = storySessions[0].original.split("\n").map(l => l.trim()).filter(Boolean);
            if (originalLines.length > 0) {
              contentName = originalLines[0].split(/\s+/).slice(0, 5).join(" ");
            }
          }
        }
        if (!contentName && scratchTopic) {
          contentName = scratchTopic;
        }
      } else {
        if (scratchTopic) {
          contentName = scratchTopic;
        } else if (sections.length > 0 && sections[0].title) {
          contentName = sections[0].title;
        }
      }
    }

    // Clean filename: remove common section prefixes, keep alphanumeric/spaces, replace spaces with underscores, maximum of first 40 chars
    let cleaned = contentName
      .replace(/^(section\s*\d+\s*:|chapter\s*\d+\s*:|part\s*\d+\s*:)/gi, "")
      .replace(/[^a-zA-Z0-9\s-_]/g, "")
      .trim()
      .replace(/[\s_]+/g, "_");

    if (!cleaned) {
      cleaned = `Absolute_${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
    } else {
      if (cleaned.length > 40) {
        cleaned = cleaned.substring(0, 40).replace(/_$/, "");
      }
    }

    saveAs(blob, `${cleaned}.docx`);
  };

  // --- End Narrator Logic ---

  const handleRetell = useCallback(async () => {
    if (!inputText.trim()) return;

    setIsProcessing(true);
    setError(null);

    try {
      const chat = ai.chats.create({
        model: "gemini-3.1-pro-preview",
        config: {
          systemInstruction: RETELLING_PROTOCOL + "\n\nCRITICAL DATE RULE: You MUST write out all dates in full words. No digits for days or years. (e.g., 'the second of March, twenty twenty three').\n\nTOTAL DISRUPTION MANDATE: You MUST destroy the original sentence and structure. If you just swap words, you have failed. Maintain the exact sequence of events as they appear in the original text but use simple spoken words.",
          temperature: 1,
        },
        history: chatHistory,
      });

      const response = await chat.sendMessage({
        message: inputText,
      });

      const result = response.text || "";
      setRetoldText(result);
      
      const newPart: StoryPart = {
        original: inputText,
        versions: [result],
        selectedIndex: 0
      };
      
      setStorySessions((prev) => [...prev, newPart]);
      
      // Update chat history for the next turn
      setChatHistory([
        ...chatHistory,
        { role: "user", parts: [{ text: inputText }] },
        { role: "model", parts: [{ text: result }] },
      ]);
      
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#d97706', '#1c1917', '#fdfcf9']
      });

      // Smooth scroll to result
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

      setInputText(""); // Clear input after successful retelling
    } catch (err) {
      console.error(err);
      setError("Something went wrong while retelling the story. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [inputText, chatHistory]);

  const handleRewritePart = async (index: number) => {
    const part = storySessions[index];
    if (!part) return;

    setRewritingIndex(index);
    setError(null);

    // Reconstruct history up to this part
    const historyUpTo: Content[] = [];
    for (let i = 0; i < index; i++) {
      const p = storySessions[i];
      historyUpTo.push({ role: "user", parts: [{ text: p.original }] });
      historyUpTo.push({ role: "model", parts: [{ text: p.versions[p.selectedIndex] }] });
    }

    try {
      const chat = ai.chats.create({
        model: "gemini-3.1-pro-preview",
        config: {
          systemInstruction: RETELLING_PROTOCOL,
          temperature: 0.7,
        },
        history: historyUpTo,
      });

      const response = await chat.sendMessage({
        message: part.original,
      });

      const result = response.text || "";
      
      setStorySessions(prev => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          versions: [...next[index].versions, result],
          selectedIndex: next[index].versions.length
        };
        return next;
      });

      // Sync chat history global state if this was the last part or influenced others
      syncChatHistoryFromSessions();

      confetti({
        particleCount: 50,
        spread: 30,
        origin: { y: 0.8 },
      });
    } catch (err) {
      console.error(err);
      setError("Failed to rewrite part. Please try again.");
    } finally {
      setRewritingIndex(null);
    }
  };

  const syncChatHistoryFromSessions = (updatedSessions?: StoryPart[]) => {
    const sessions = updatedSessions || storySessions;
    const newHistory: Content[] = [];
    sessions.forEach(part => {
      newHistory.push({ role: "user", parts: [{ text: part.original }] });
      newHistory.push({ role: "model", parts: [{ text: part.versions[part.selectedIndex] }] });
    });
    setChatHistory(newHistory);
  };

  const handleSelectVersion = (partIndex: number, versionIndex: number) => {
    setStorySessions(prev => {
      const next = [...prev];
      next[partIndex] = { ...next[partIndex], selectedIndex: versionIndex };
      syncChatHistoryFromSessions(next);
      return next;
    });
  };

  const handleDeletePart = (index: number) => {
    if (!confirm("Are you sure you want to delete this part? This will remove all its saved versions.")) return;
    setStorySessions(prev => {
      const next = prev.filter((_, i) => i !== index);
      syncChatHistoryFromSessions(next);
      return next;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const copyAll = () => {
      const fullText = mode === "retell" 
      ? storySessions.map(s => s.versions[s.selectedIndex]).join("\n\n")
      : mode === "narrate"
      ? sections.map(s => s.narrativeVersions && s.selectedNarrativeIndex !== undefined ? s.narrativeVersions[s.selectedNarrativeIndex] : s.narrative).filter(Boolean).join("\n\n")
      : sections.map(s => `
# SECTION ${s.sectionNumber || ""}: ${s.title.toUpperCase()}
Time Period: ${s.timePeriod || "---"}
Word Count Target: ${s.wordCountTarget || s.estimatedWordCount || 500} words
Narrative Beat: ${s.narrativeBeat || "---"}
Primary Focus: ${s.primaryFocus || "---"}
Boundaries: ${s.startEvent || "---"} to ${s.endEvent || "---"}

## Core Narrative Beats
${(s.keyEvents || s.bullets || []).map(b => `- ${b}`).join("\n")}

## Suspense Exclusions
${(s.whatNotToInclude || s.exclusions || []).map(e => `- ${e}`).join("\n")}
      `).join("\n\n---\n\n");
    
    navigator.clipboard.writeText(fullText);
    confetti({
      particleCount: 20,
      spread: 20,
      origin: { y: 0.9 },
      colors: ['#d97706']
    });
  };

  const startNewStory = () => {
    if (storySessions.length > 0) {
      setIsConfirmingNewStory(true);
    } else {
      executeReset();
    }
  };

  const executeReset = () => {
    setInputText("");
    setRetoldText("");
    setStorySessions([]);
    setChatHistory([]);
    setError(null);
    setIsConfirmingNewStory(false);
    localStorage.removeItem(STORAGE_KEY);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleImport = () => {
    if (!importText.trim()) return;

    const newHistory: Content[] = [
      { role: "user", parts: [{ text: "This is the story retold so far. Please continue retelling from this point with the next script I provide." }] },
      { role: "model", parts: [{ text: importText }] }
    ];

    setStorySessions([{ 
      original: "[Imported Context]", 
      versions: [importText],
      selectedIndex: 0 
    }]);
    setChatHistory(newHistory);
    setIsImporting(false);
    setImportText("");
    
    confetti({
      particleCount: 50,
      spread: 30,
      colors: ['#d97706']
    });
  };

  const resetInput = () => {
    setInputText("");
    setError(null);
  };

  const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

  const examples = [
    {
      label: "Military History",
      text: "The garrison, having been informed of the impending insurgency, commenced a strategic withdrawal. Subsequently, the regiment mutinied and resided in the abandoned outpost, whereby they utilized the remaining provisions."
    },
    {
      label: "Formal Report",
      text: "It was stated and revealed that the culprit utilized a specialized tool to obtain the jewels. Furthermore, the authorities ascertained that he resided within the city limits and had endeavors to flee henceforth."
    }
  ];

  return (
    <div className="min-h-screen py-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-12">
      {/* Header */}
      <header className="text-center space-y-8">
        <div className="flex flex-col items-center gap-4">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-accent/10 text-accent font-medium text-sm tracking-wide uppercase"
          >
            <Sparkles className="w-4 h-4" />
            Absolute Protocol v2.0
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-5xl md:text-7xl font-serif font-bold tracking-tight text-warm-ink"
          >
            Absolute <span className="italic">{mode === "retell" ? "Reteller" : "Narrator"}</span>
          </motion.h1>

          <div className="flex items-center bg-warm-ink/5 p-1 rounded-full border border-warm-ink/10 shadow-inner">
            <button
              onClick={() => setMode("retell")}
              className={`flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                mode === "retell" ? "bg-white text-warm-ink shadow-md" : "text-warm-ink/40 hover:text-warm-ink"
              }`}
            >
              <PenTool className="w-4 h-4" />
              Retell
            </button>
            <button
              onClick={() => setMode("narrate")}
              className={`flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                mode === "narrate" ? "bg-white text-warm-ink shadow-md" : "text-warm-ink/40 hover:text-warm-ink"
              }`}
            >
              <BookOpen className="w-4 h-4" />
              Narrate
            </button>
            <button
              onClick={() => setMode("outlining")}
              className={`flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                mode === "outlining" ? "bg-white text-warm-ink shadow-md" : "text-warm-ink/40 hover:text-warm-ink"
              }`}
            >
              <LayoutList className="w-4 h-4" />
              Outliner
            </button>
          </div>
        </div>

        <motion.p 
          key={mode}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-lg text-warm-ink/60 max-w-2xl mx-auto font-sans"
        >
          {mode === "retell" 
            ? "Clean-slate logic for clear communication. We don't edit, we rebuild."
            : mode === "narrate"
            ? "Transform sparse outlines into deep, professional narratives using structured research."
            : "Deep research and procedural refinement for story structures. Find errors, fix pacing, and harden the core."
          }
        </motion.p>
      </header>

      <main className="grid grid-cols-1 gap-12">
        <AnimatePresence mode="wait">
          {mode === "retell" ? (
            <motion.div
              key="retell-mode"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-12"
            >
              {/* Input Section */}
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs uppercase tracking-widest font-bold text-warm-ink/50 flex items-center gap-2">
                    <span className="w-8 h-[1px] bg-warm-ink/20"></span>
                    Paste Original Text
                  </h2>
                  <div className="flex items-center gap-4">
                    {chatHistory.length > 0 ? (
                      <button 
                        onClick={startNewStory}
                        className="text-xs font-bold text-accent px-4 py-2 rounded-full bg-accent/10 hover:bg-accent/20 flex items-center gap-2 transition-all"
                      >
                        <PlusCircle className="w-4 h-4" />
                        New Story
                      </button>
                    ) : (
                      <button 
                        onClick={() => setIsImporting(true)}
                        className="text-xs font-bold text-warm-ink/40 px-4 py-2 rounded-full bg-warm-ink/5 hover:bg-warm-ink/10 flex items-center gap-2 transition-all border border-warm-ink/5"
                      >
                        <Import className="w-4 h-4" />
                        Resume Progress
                      </button>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold text-warm-ink/30">Try an example:</span>
                      {examples.map((ex) => (
                        <button
                          key={ex.label}
                          onClick={() => setInputText(ex.text)}
                          className="text-[10px] font-bold px-2 py-1 rounded bg-accent/5 text-accent hover:bg-accent/10 transition-colors"
                        >
                          {ex.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="relative group">
                  <textarea
                    className="w-full h-80 p-8 bg-white border border-warm-ink/10 rounded-3xl shadow-sm focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none transition-all font-sans text-lg leading-relaxed resize-none"
                    placeholder="Enter the dense, formal, or complex story here..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    disabled={isProcessing}
                  />
                  {inputText && (
                    <div className="absolute bottom-6 right-6 flex items-center gap-4">
                      <div className="text-xs font-mono text-warm-ink/30">
                        {wordCount(inputText)} words
                      </div>
                      <button
                        onClick={handleRetell}
                        disabled={isProcessing}
                        className="bg-warm-ink text-warm-bg px-6 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform disabled:opacity-50 disabled:scale-100 shadow-xl"
                      >
                        {isProcessing ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Wand2 className="w-5 h-5" />
                        )}
                        {isProcessing ? "Rebuilding..." : "Retell Story"}
                      </button>
                    </div>
                  )}
                </div>
              </section>

              {/* Results */}
              <AnimatePresence mode="popLayout">
                {isProcessing && storySessions.length === 0 && (
                  <motion.div
                    key="initial-loader"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="py-20 text-center space-y-6"
                  >
                    <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto relative text-accent">
                      <div className="absolute inset-0 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
                      <Wand2 className="w-8 h-8" />
                    </div>
                    <p className="text-lg font-serif italic text-warm-ink/60 animate-pulse">
                      Absorbing the heart of the story...
                    </p>
                  </motion.div>
                )}

                {error && (
                  <motion.div
                    key="error-message"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-6 bg-red-50 border border-red-200 rounded-3xl text-red-600 text-sm font-medium text-center"
                  >
                    {error}
                  </motion.div>
                )}

                {storySessions.length > 0 && (
                  <motion.div
                    key="results-container"
                    ref={resultRef}
                    className="space-y-16 pb-32"
                  >
                    <div className="flex items-center justify-between border-b-2 border-warm-ink/5 pb-6">
                      <h2 className="font-serif text-3xl font-bold text-warm-ink flex items-center gap-3">
                        The Full Narrative
                        <div className="text-[10px] font-mono text-warm-ink/30 bg-warm-ink/5 px-2 py-1 rounded tracking-widest uppercase">
                          {storySessions.length} {storySessions.length === 1 ? 'Part' : 'Parts'}
                        </div>
                      </h2>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={downloadAsDocx}
                          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest bg-green-600 text-white px-6 py-3 rounded-full hover:scale-105 transition-transform shadow-lg shadow-green-600/20"
                        >
                          <Download className="w-4 h-4" />
                          Download .DOCX
                        </button>
                        <button 
                          onClick={copyAll}
                          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest bg-accent text-white px-6 py-3 rounded-full hover:scale-105 transition-transform shadow-lg shadow-accent/20"
                        >
                          <Copy className="w-4 h-4" />
                          Copy Entire Story
                        </button>
                      </div>
                    </div>

                    {storySessions.map((session, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="space-y-8 group/part"
                      >
                        <div className="flex items-center justify-between border-b border-warm-ink/10 pb-4">
                          <div className="space-y-1">
                            <h2 className="font-serif text-2xl font-bold flex items-center gap-3 text-warm-ink/40">
                              Part {index + 1}
                            </h2>
                            {session.versions.length > 1 && (
                              <div className="flex items-center gap-2 px-1">
                                <button 
                                  disabled={session.selectedIndex === 0 || rewritingIndex !== null}
                                  onClick={() => handleSelectVersion(index, session.selectedIndex - 1)}
                                  className="p-1 hover:bg-warm-ink/5 rounded text-warm-ink/40 disabled:opacity-20"
                                >
                                  <ChevronLeft className="w-4 h-4" />
                                </button>
                                <div className="text-[10px] font-mono font-bold text-accent px-2 bg-accent/5 rounded">
                                  v{session.selectedIndex + 1} of {session.versions.length}
                                </div>
                                <button 
                                  disabled={session.selectedIndex === session.versions.length - 1 || rewritingIndex !== null}
                                  onClick={() => handleSelectVersion(index, session.selectedIndex + 1)}
                                  className="p-1 hover:bg-warm-ink/5 rounded text-warm-ink/40 disabled:opacity-20"
                                >
                                  <ChevronRight className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-xs font-mono text-warm-ink/40 bg-warm-ink/5 px-3 py-1 rounded-full uppercase tracking-tighter">
                              {wordCount(session.versions[session.selectedIndex])} words 
                            </div>
                            
                            <div className="flex items-center bg-warm-ink/5 rounded-full p-1 opacity-0 group-hover/part:opacity-100 transition-opacity">
                              <button 
                                onClick={() => handleRewritePart(index)}
                                disabled={rewritingIndex !== null || isProcessing}
                                className="p-2 hover:bg-accent/10 hover:text-accent rounded-full transition-colors relative group/action"
                                title="Rewrite this part"
                              >
                                {rewritingIndex === index ? (
                                  <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                  <RefreshCcw className="w-5 h-5" />
                                )}
                              </button>
                              <button 
                                onClick={() => copyToClipboard(session.versions[session.selectedIndex])}
                                className="p-2 hover:bg-white text-warm-ink/60 rounded-full transition-colors relative"
                                title="Copy version"
                              >
                                <Copy className="w-5 h-5" />
                              </button>
                              <button 
                                onClick={() => handleDeletePart(index)}
                                disabled={rewritingIndex !== null || isProcessing}
                                className="p-2 hover:bg-red-50 text-red-300 hover:text-red-500 rounded-full transition-colors relative"
                                title="Delete part"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className={`story-content font-serif text-xl md:text-2xl text-warm-ink leading-relaxed max-w-3xl mx-auto selection:bg-accent/30 drop-shadow-sm transition-opacity ${rewritingIndex === index ? 'opacity-30' : 'opacity-100'}`}>
                          <Markdown>{session.versions[session.selectedIndex]}</Markdown>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="narrate-mode"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-12"
            >
              {/* Outline Phase */}
              {(currentNarratorStep === "idle" || sections.length === 0) && (
                <div className="space-y-12">
                   {(!outlineSource && mode === "outlining") ? (
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <button 
                          onClick={() => setOutlineSource("scratch")}
                          className="group p-10 bg-white border border-warm-ink/10 rounded-[3rem] text-left hover:border-accent transition-all hover:shadow-2xl hover:shadow-accent/5 flex flex-col items-start"
                        >
                           <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center text-accent mb-8 group-hover:rotate-12 transition-transform">
                              <Sparkles className="w-8 h-8" />
                           </div>
                           <h3 className="text-2xl font-serif font-bold text-warm-ink mb-3">Create From Scratch</h3>
                           <p className="text-sm text-warm-ink/40 font-sans leading-relaxed">Provide a topic or title and let the protocol research, plan, and structure the narrative for you automatically.</p>
                        </button>
                        <button 
                           onClick={() => setOutlineSource("existing")}
                           className="group p-10 bg-white border border-warm-ink/10 rounded-[3rem] text-left hover:border-accent transition-all hover:shadow-2xl hover:shadow-accent/5 flex flex-col items-start"
                        >
                           <div className="w-16 h-16 bg-warm-ink/5 rounded-2xl flex items-center justify-center text-warm-ink/60 mb-8 group-hover:-rotate-12 transition-transform">
                              <Import className="w-8 h-8" />
                           </div>
                           <h3 className="text-2xl font-serif font-bold text-warm-ink mb-3">From Existing Outline</h3>
                           <p className="text-sm text-warm-ink/40 font-sans leading-relaxed">Upload a Word document or paste an existing outline to refine and reconstruct it using forensic structural protocols.</p>
                        </button>
                     </div>
                   ) : (outlineSource === "scratch" && mode === "outlining") ? (
                      <section className="space-y-6">
                         <div className="flex items-center justify-between">
                            <h2 className="text-xs uppercase tracking-widest font-bold text-warm-ink/50 flex items-center gap-2">
                               <span className="w-8 h-[1px] bg-warm-ink/20"></span>
                               Project Title or Case Topic
                            </h2>
                            <button onClick={() => setOutlineSource(null)} className="text-[10px] font-bold uppercase tracking-widest text-warm-ink/40 hover:text-accent transition-colors">
                               Cancel Selection
                            </button>
                         </div>
                         <div className="relative group">
                            <input
                              className="w-full p-8 bg-white border border-warm-ink/10 rounded-[2.5rem] shadow-sm focus:ring-4 focus:ring-accent/10 focus:border-accent outline-none transition-all font-serif text-3xl placeholder:text-warm-ink/10"
                              placeholder="e.g. The 1986 Dansoman Ritual Killings"
                              value={scratchTopic}
                              onChange={(e) => setScratchTopic(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleGenerateDraftSections()}
                              disabled={narratorIsProcessing}
                            />
                            {scratchTopic && (
                              <div className="absolute top-1/2 -translate-y-1/2 right-6">
                                <button
                                  onClick={handleGenerateDraftSections}
                                  disabled={narratorIsProcessing}
                                  className="bg-accent text-white px-8 py-4 rounded-full font-bold flex items-center gap-3 hover:scale-105 active:scale-95 transition-transform disabled:opacity-50 shadow-xl shadow-accent/20"
                                >
                                  {narratorIsProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
                                  {narratorIsProcessing ? "Analysing Topic..." : "Begin Deep Research"}
                                </button>
                              </div>
                            )}
                         </div>
                      </section>
                   ) : (
                    <section className="space-y-6">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs uppercase tracking-widest font-bold text-warm-ink/50 flex items-center gap-2">
                          <span className="w-8 h-[1px] bg-warm-ink/20"></span>
                          Story Outline (Document or Text)
                        </h2>
                        <div className="flex items-center gap-4">
                          <button onClick={() => setOutlineSource(null)} className="text-[10px] font-bold uppercase tracking-widest text-warm-ink/40 hover:text-accent transition-colors">
                              Go Back
                          </button>
                          <label className="text-xs font-bold text-accent px-4 py-2 rounded-full bg-accent/10 hover:bg-accent/20 flex items-center gap-2 transition-all cursor-pointer border border-accent/20">
                            <Import className="w-4 h-4" />
                            {outlineFile ? "File Selected" : "Upload PDF/Doc"}
                            <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={handleFileUpload} />
                          </label>
                          {outlineFile && (
                            <button onClick={() => setOutlineFile(null)} className="p-2 hover:bg-red-50 text-red-400 rounded-full">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="relative group">
                        <textarea
                          className="w-full h-96 p-8 bg-white border border-warm-ink/10 rounded-[2.5rem] shadow-sm focus:ring-4 focus:ring-accent/10 focus:border-accent outline-none transition-all font-sans text-lg leading-relaxed resize-none"
                          placeholder="Paste your full story outline here, or upload a document above..."
                          value={outlineText}
                          onChange={(e) => setOutlineText(e.target.value)}
                          disabled={narratorIsProcessing}
                        />
                        {(outlineText || outlineFile) && (
                          <div className="absolute bottom-6 right-6">
                            <button
                              onClick={handleParseOutline}
                              disabled={narratorIsProcessing}
                              className="bg-warm-ink text-warm-bg px-8 py-4 rounded-full font-bold flex items-center gap-3 hover:scale-105 active:scale-95 transition-transform disabled:opacity-50 shadow-2xl"
                            >
                              {narratorIsProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <LayoutList className="w-5 h-5" />}
                              Analyze Outline
                            </button>
                          </div>
                        )}
                      </div>
                    </section>
                   )}
                </div>
              )}

              {/* Research & Narration Phase */}
              {sections.length > 0 && (
                <section className="space-y-12">
                  {/* Summary Card */}
                  <div className="bg-white border border-warm-ink/10 rounded-[2.5rem] p-10 shadow-xl space-y-8">
                    {/* Stepper Navigation */}
                    <div className="flex items-center gap-2 overflow-x-auto pb-4 scrollbar-hide">
                      {steps.map((step, idx) => {
                        const isReached = steps.indexOf(maxReachedStep) >= idx;
                        const isActive = currentNarratorStep === step;
                        return (
                          <div key={step} className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => goToStep(step)}
                              disabled={!isReached}
                              className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                                isActive 
                                  ? 'bg-accent text-white shadow-lg shadow-accent/20' 
                                  : isReached 
                                    ? 'bg-warm-ink/5 text-warm-ink/60 hover:bg-warm-ink/10' 
                                    : 'bg-warm-ink/[0.02] text-warm-ink/20 cursor-not-allowed border border-warm-ink/5'
                              }`}
                            >
                              <span className="opacity-40 mr-1.5">{idx + 1}.</span>
                              {step}
                            </button>
                            {idx < steps.length - 1 && (
                              <ChevronRight className={`w-3 h-3 ${steps.indexOf(maxReachedStep) > idx ? 'text-accent/40' : 'text-warm-ink/10'}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-6">
                        <button 
                          onClick={goBack}
                          className="p-3 hover:bg-warm-ink/5 rounded-2xl text-warm-ink/40 transition-all hover:scale-110 active:scale-90"
                          title="Navigate to previous step"
                        >
                          <ChevronLeft className="w-8 h-8" />
                        </button>
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-accent/10 flex items-center justify-center">
                              <CheckCircle2 className="w-6 h-6 text-accent" />
                            </div>
                            <h3 className="text-2xl font-serif font-bold text-warm-ink">Working Outline</h3>
                          </div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-warm-ink/30 ml-1">Phase: {currentNarratorStep}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <button 
                          onClick={downloadAsDocx}
                          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest bg-green-600 text-white px-6 py-3 rounded-full hover:scale-105 active:scale-95 transition-all shadow-xl shadow-green-600/20"
                        >
                          <Download className="w-4 h-4" />
                          Download .DOCX
                        </button>
                        <button 
                          onClick={copyAll}
                          disabled={sections.every(s => !s.narrative && mode !== "outlining")}
                          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest bg-accent text-white px-6 py-3 rounded-full hover:scale-105 active:scale-95 transition-all shadow-xl shadow-accent/20 disabled:opacity-30 disabled:hover:scale-100"
                        >
                          <Copy className="w-4 h-4" />
                          {mode === "outlining" ? "Copy Outline" : "Copy Narrative"}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4">
                      <div className="text-center p-5 bg-warm-ink/5 rounded-[2rem] border border-warm-ink/5 min-w-[120px] flex-1 sm:flex-initial">
                        <div className="text-3xl font-serif font-bold text-accent">{sections.length}</div>
                        <div className="text-[10px] uppercase font-bold text-warm-ink/30 tracking-widest">Sections</div>
                      </div>
                      <div className="text-center p-5 bg-warm-ink/5 rounded-[2rem] border border-warm-ink/5 min-w-[160px] flex-1 sm:flex-initial">
                        <div className="text-2xl font-serif font-bold text-accent whitespace-nowrap">
                          {totalOutlineWords.toLocaleString()}
                        </div>
                        <div className="text-[10px] uppercase font-bold text-warm-ink/30 tracking-widest">Total Outline Words</div>
                      </div>
                      <div className="text-center p-5 bg-warm-ink/5 rounded-[2rem] border border-warm-ink/5 min-w-[160px] flex-1 sm:flex-initial">
                        <div className="text-2xl font-serif font-bold text-accent whitespace-nowrap">
                          {totalActualWords.toLocaleString()} <span className="text-xs text-warm-ink/40 font-sans font-normal">/ {totalEstimatedWords.toLocaleString()}</span>
                        </div>
                        <div className="text-[10px] uppercase font-bold text-warm-ink/30 tracking-widest">Total Narrative Words</div>
                      </div>
                    </div>

                    {mode === "outlining" && outlineSource === "existing" && (
                      <div className="p-6 bg-amber-50/50 border border-amber-500/15 rounded-[2rem] space-y-4">
                        <div className="flex items-center gap-2">
                          <Wand2 className="w-4 h-4 text-amber-600" />
                          <h4 className="text-xs font-black uppercase tracking-widest text-amber-800">Narrative Restructural Protocol</h4>
                        </div>
                        <p className="text-xs text-warm-ink/60 leading-relaxed font-sans">
                          Select the protocol strategy for outline planning, audits, and final chronologization.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-sans">
                          <button
                            onClick={() => {
                              setOutlinerStrategy("hook");
                              confetti({ particleCount: 15, colors: ["#d97706"] });
                            }}
                            className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all select-none hover:scale-[1.01] ${
                              outlinerStrategy === "hook"
                                ? "bg-white border-amber-500 shadow-md shadow-amber-500/5 ring-1 ring-amber-500/20"
                                : "bg-white/50 border-warm-ink/10 hover:border-warm-ink/20 hover:bg-white"
                            }`}
                          >
                            <div className="space-y-1">
                              <span className={`text-[9px] font-black uppercase tracking-widest ${outlinerStrategy === "hook" ? "text-amber-600" : "text-warm-ink/40"}`}>Strategy A</span>
                              <h5 className="text-xs font-bold text-warm-ink">Hook-First Restructure</h5>
                              <p className="text-[10px] text-warm-ink/50 leading-relaxed font-sans">
                                Challenges boring family/childhood history. Automatically hook-starts the narrative at the peak scene/disruption and orders sections around it.
                              </p>
                            </div>
                            <div className="flex items-center justify-end w-full pt-2">
                              <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${outlinerStrategy === "hook" ? "border-amber-500" : "border-warm-ink/20"}`}>
                                {outlinerStrategy === "hook" && <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                              </div>
                            </div>
                          </button>

                          <button
                            onClick={() => {
                              setOutlinerStrategy("preserve_start");
                              confetti({ particleCount: 15, colors: ["#d97706"] });
                            }}
                            className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all select-none hover:scale-[1.01] ${
                              outlinerStrategy === "preserve_start"
                                ? "bg-white border-amber-500 shadow-md shadow-amber-500/5 ring-1 ring-amber-500/20"
                                : "bg-white/50 border-warm-ink/10 hover:border-warm-ink/20 hover:bg-white"
                            }`}
                          >
                            <div className="space-y-1">
                              <span className={`text-[9px] font-black uppercase tracking-widest ${outlinerStrategy === "preserve_start" ? "text-amber-600" : "text-warm-ink/40"}`}>Strategy B</span>
                              <h5 className="text-xs font-bold text-warm-ink">Preserve-Start Restructure</h5>
                              <p className="text-[10px] text-warm-ink/50 leading-relaxed font-sans">
                                Starts exactly where the original outline starts. Subsequent sections are rearranged chronologically from there while fully preserving early plot info and details.
                              </p>
                            </div>
                            <div className="flex items-center justify-end w-full pt-2">
                              <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${outlinerStrategy === "preserve_start" ? "border-amber-500" : "border-warm-ink/20"}`}>
                                {outlinerStrategy === "preserve_start" && <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                              </div>
                            </div>
                          </button>

                          <button
                            onClick={() => {
                              setOutlinerStrategy("preserve_structure");
                              confetti({ particleCount: 15, colors: ["#d97706"] });
                            }}
                            className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all select-none hover:scale-[1.01] ${
                              outlinerStrategy === "preserve_structure"
                                ? "bg-white border-amber-500 shadow-md shadow-amber-500/5 ring-1 ring-amber-500/20"
                                : "bg-white/50 border-warm-ink/10 hover:border-warm-ink/20 hover:bg-white"
                            }`}
                          >
                            <div className="space-y-1">
                              <span className={`text-[9px] font-black uppercase tracking-widest ${outlinerStrategy === "preserve_structure" ? "text-amber-600" : "text-warm-ink/40"}`}>Strategy C</span>
                              <h5 className="text-xs font-bold text-warm-ink">Preserve Structure Completely</h5>
                              <p className="text-[10px] text-warm-ink/50 leading-relaxed font-sans">
                                Maintains exact section structure, titles, events, and sequence verbatim. Aggressively audits and corrects voice, testimony, and investigator violations without rearranging layout.
                              </p>
                            </div>
                            <div className="flex items-center justify-end w-full pt-2">
                              <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${outlinerStrategy === "preserve_structure" ? "border-amber-500" : "border-warm-ink/20"}`}>
                                {outlinerStrategy === "preserve_structure" && <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                    )}

                    {currentNarratorStep === "parsed" && (
                      <div className="pt-6 border-t border-warm-ink/5 flex flex-col gap-6">
                        {/* Research Source Selector Card */}
                        <div className="p-6 bg-emerald-50/50 border border-emerald-500/15 rounded-[2rem] space-y-4">
                          <div className="flex items-center gap-2">
                            <Search className="w-4 h-4 text-emerald-600" />
                            <h4 className="text-xs font-black uppercase tracking-widest text-emerald-800 font-sans">Research Source Selection</h4>
                          </div>
                          <p className="text-xs text-warm-ink/60 leading-relaxed font-sans">
                            How should the system compile research dossiers for each section/chapter?
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {/* Option 1: AI Only */}
                            <button
                              onClick={() => {
                                setUserResearchSource("system");
                                confetti({ particleCount: 15, colors: ["#059669"] });
                              }}
                              className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all select-none hover:scale-[1.01] ${
                                userResearchSource === "system"
                                  ? "bg-white border-emerald-500 shadow-md shadow-emerald-500/5 ring-1 ring-emerald-500/20"
                                  : "bg-white/50 border-warm-ink/10 hover:border-warm-ink/20 hover:bg-white"
                              }`}
                            >
                              <div className="space-y-1">
                                <span className={`text-[9px] font-black uppercase tracking-widest ${userResearchSource === "system" ? "text-emerald-600" : "text-warm-ink/40"}`}>Option A</span>
                                <h5 className="text-xs font-bold text-warm-ink">Only AI Research</h5>
                                <p className="text-[10px] text-warm-ink/50 leading-relaxed font-sans">
                                  Automatically gathers independent background facts, context, and events from story topics.
                                </p>
                              </div>
                              <div className="flex items-center justify-end w-full pt-2">
                                <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${userResearchSource === "system" ? "border-emerald-500" : "border-warm-ink/20"}`}>
                                  {userResearchSource === "system" && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                                </div>
                              </div>
                            </button>

                            {/* Option 2: User Research Only */}
                            <button
                              onClick={() => {
                                setUserResearchSource("user");
                                confetti({ particleCount: 15, colors: ["#059669"] });
                              }}
                              className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all select-none hover:scale-[1.01] ${
                                userResearchSource === "user"
                                  ? "bg-white border-emerald-500 shadow-md shadow-emerald-500/5 ring-1 ring-emerald-500/20"
                                  : "bg-white/50 border-warm-ink/10 hover:border-warm-ink/20 hover:bg-white"
                              }`}
                            >
                              <div className="space-y-1">
                                <span className={`text-[9px] font-black uppercase tracking-widest ${userResearchSource === "user" ? "text-emerald-600" : "text-warm-ink/40"}`}>Option B</span>
                                <h5 className="text-xs font-bold text-warm-ink">My Research Only</h5>
                                <p className="text-[10px] text-warm-ink/50 leading-relaxed font-sans">
                                  Matches your uploaded full-length research document onto individual story sections.
                                </p>
                              </div>
                              <div className="flex items-center justify-end w-full pt-2">
                                <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${userResearchSource === "user" ? "border-emerald-500" : "border-warm-ink/20"}`}>
                                  {userResearchSource === "user" && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                                </div>
                              </div>
                            </button>

                            {/* Option 3: Combined */}
                            <button
                              onClick={() => {
                                setUserResearchSource("combined");
                                confetti({ particleCount: 15, colors: ["#059669"] });
                              }}
                              className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all select-none hover:scale-[1.01] ${
                                userResearchSource === "combined"
                                  ? "bg-white border-emerald-500 shadow-md shadow-emerald-500/5 ring-1 ring-emerald-500/20"
                                  : "bg-white/50 border-warm-ink/10 hover:border-warm-ink/20 hover:bg-white"
                              }`}
                            >
                              <div className="space-y-1">
                                <span className={`text-[9px] font-black uppercase tracking-widest ${userResearchSource === "combined" ? "text-emerald-600" : "text-warm-ink/40"}`}>Option C</span>
                                <h5 className="text-xs font-bold text-warm-ink">Combine Both</h5>
                                <p className="text-[10px] text-warm-ink/50 leading-relaxed font-sans">
                                  Combines AI background expansion with your uploaded manual research elements seamlessly.
                                </p>
                              </div>
                              <div className="flex items-center justify-end w-full pt-2">
                                <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${userResearchSource === "combined" ? "border-emerald-500" : "border-warm-ink/20"}`}>
                                  {userResearchSource === "combined" && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                                </div>
                              </div>
                            </button>

                            {/* Option 4: Skip Research */}
                            <button
                              onClick={() => {
                                setUserResearchSource("skip");
                                confetti({ particleCount: 15, colors: ["#059669"] });
                              }}
                              className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all select-none hover:scale-[1.01] ${
                                userResearchSource === "skip"
                                  ? "bg-white border-emerald-500 shadow-md shadow-emerald-500/5 ring-1 ring-emerald-500/20"
                                  : "bg-white/50 border-warm-ink/10 hover:border-warm-ink/20 hover:bg-white"
                              }`}
                            >
                              <div className="space-y-1">
                                <span className={`text-[9px] font-black uppercase tracking-widest ${userResearchSource === "skip" ? "text-emerald-600" : "text-warm-ink/40"}`}>Option D</span>
                                <h5 className="text-xs font-bold text-warm-ink">Skip Research</h5>
                                <p className="text-[10px] text-warm-ink/50 leading-relaxed font-sans">
                                  Bypasses the research phase entirely. Jump straight to outline planning, preserving your Gemini API quota.
                                </p>
                              </div>
                              <div className="flex items-center justify-end w-full pt-2">
                                <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${userResearchSource === "skip" ? "border-emerald-500" : "border-warm-ink/20"}`}>
                                  {userResearchSource === "skip" && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                                </div>
                              </div>
                            </button>
                          </div>

                          {/* File Upload / Paste Area when Custom Research is required */}
                          {(userResearchSource === "user" || userResearchSource === "combined") && (
                            <div className="pt-4 space-y-4 border-t border-emerald-500/10">
                              <label className="block text-xs uppercase tracking-wider font-bold text-emerald-800">
                                Upload or Paste Your Research Document
                              </label>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Left: paste text */}
                                <textarea
                                  value={userResearchText}
                                  onChange={(e) => setUserResearchText(e.target.value)}
                                  placeholder="Paste your comprehensive custom research text here..."
                                  className="w-full text-xs p-4 bg-white/70 border border-warm-ink/10 rounded-2xl focus:border-emerald-500 focus:bg-white outline-none min-h-[140px] font-sans resize-y leading-relaxed"
                                />

                                {/* Right: file drop/upload */}
                                <div className="relative border-2 border-dashed border-emerald-500/20 hover:border-emerald-500/40 rounded-2xl p-6 flex flex-col items-center justify-center bg-white/30 hover:bg-white/60 transition-all text-center min-h-[140px]">                                  <input
                                    type="file"
                                    accept=".txt,.doc,.docx,.pdf"
                                    className="absolute inset-x-0 inset-y-0 w-full h-full opacity-0 cursor-pointer"
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      setUserResearchFileName(file.name);
                                      if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
                                        try {
                                          const arrayBuffer = await file.arrayBuffer();
                                          const result = await mammoth.extractRawText({ arrayBuffer });
                                          setUserResearchText(result.value);
                                          setUserResearchFile(null);
                                          confetti({ particleCount: 20, colors: ["#059669"] });
                                        } catch (err) {
                                          setError("Failed to extract Word document research. Please copy & paste directly.");
                                        }
                                      } else if (file.type === "application/pdf") {
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                          const base64 = ev.target?.result as string;
                                          setUserResearchFile({
                                            data: base64.split(",")[1],
                                            mimeType: file.type
                                          });
                                          setUserResearchText(""); // Clear text since we are passing the PDF file directly to Gemini
                                          confetti({ particleCount: 20, colors: ["#059669"] });
                                        };
                                        reader.readAsDataURL(file);
                                      } else {
                                        // plain text file
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                          setUserResearchText(ev.target?.result as string || "");
                                          setUserResearchFile(null);
                                          confetti({ particleCount: 20, colors: ["#059669"] });
                                        };
                                        reader.readAsText(file);
                                      }
                                    }}
                                  />
                                  <Import className="w-6 h-6 text-emerald-600/60 mb-2" />
                                  <span className="text-xs font-bold text-emerald-900 block">
                                    {userResearchFileName ? `Selected: ${userResearchFileName}` : "Upload Document / PDF"}
                                  </span>
                                  <span className="text-[10px] text-warm-ink/40 mt-1 block">
                                    Drag or tap to upload PDF, .docx, or text file
                                  </span>
                                </div>
                              </div>

                              {(userResearchText.trim().length > 0 || userResearchFile) && (
                                <div className="flex items-center justify-between p-3 bg-emerald-500/15 border border-emerald-500/20 rounded-xl">
                                  <span className="text-[10px] font-bold text-emerald-800">
                                    {userResearchFile 
                                      ? `✓ Research PDF Loaded: ${userResearchFileName}` 
                                      : `✓ Research Text Loaded (${userResearchText.split(/\s+/).filter(Boolean).length} words)`}
                                  </span>
                                  <button
                                    onClick={() => {
                                      setUserResearchText("");
                                      setUserResearchFileName("");
                                      setUserResearchFile(null);
                                    }}
                                    className="text-[10px] text-red-700 hover:text-red-900 font-bold hover:underline"
                                  >
                                    Clear Document
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <button
                          onClick={handleResearchAll}
                          disabled={narratorIsProcessing}
                          className="w-full bg-accent text-white py-6 rounded-3xl font-bold flex items-center justify-center gap-4 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-accent/20"
                        >
                          {narratorIsProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : (mode === "outlining" ? <Wand2 className="w-6 h-6" /> : <Search className="w-6 h-6" />)}
                          <div className="text-left">
                            <span className="block text-sm uppercase tracking-widest font-black">
                              {mode === "outlining" ? "Step 2: Research & Gathering" : "Step 2: Start Deep Research"}
                            </span>
                            <span className="block text-xs font-normal opacity-80">
                              {mode === "outlining" 
                                ? "Conduct forensic research to identify hidden details and characters."
                                : `Flesh out bullets with detail for all ${sections.length} sections.`}
                            </span>
                          </div>
                        </button>
                        {steps.indexOf(maxReachedStep) > steps.indexOf("parsed") && (
                          <button
                            onClick={goForward}
                            className="text-xs font-bold uppercase tracking-widest text-accent text-center py-2 hover:underline"
                          >
                            Skip to Researched Dossier →
                          </button>
                        )}
                      </div>
                    )}

                    {currentNarratorStep === "researched" && mode === "outlining" && (
                      <div className="pt-6 border-t border-warm-ink/5 flex flex-col gap-4">
                        <button
                          onClick={() => handlePlanOutline(sections)}
                          disabled={narratorIsProcessing}
                          className="w-full bg-accent text-white py-6 rounded-3xl font-bold flex items-center justify-center gap-4 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-accent/20"
                        >
                          {narratorIsProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <LayoutList className="w-6 h-6" />}
                          <div className="text-left">
                            <span className="block text-sm uppercase tracking-widest font-black">Step 3: Forensic Planning</span>
                            <span className="block text-xs font-normal opacity-80">Audit structure, perspective, and repetition before rewriting.</span>
                          </div>
                        </button>
                        {steps.indexOf(maxReachedStep) > steps.indexOf("researched") && (
                          <button
                            onClick={goForward}
                            className="text-xs font-bold uppercase tracking-widest text-accent text-center py-2 hover:underline"
                          >
                            Skip to Planning Strategy →
                          </button>
                        )}
                      </div>
                    )}

                    {currentNarratorStep === "planned" && mode === "outlining" && (
                      <div className="space-y-8 pt-10 border-t border-warm-ink/5">
                        <div className="bg-warm-bg border-2 border-accent/20 rounded-3xl p-8 space-y-6">
                          <div className="flex items-center gap-3 text-accent transition-all">
                            <FileText className="w-6 h-6" />
                            <h4 className="text-sm font-black uppercase tracking-widest text-accent">Internal Planning Document</h4>
                          </div>
                          
                          <EditableText 
                            label="Planning Document" 
                            value={outlinePlan} 
                            onChange={setOutlinePlan}
                            multiline
                            markdown
                          />
                        </div>

                        <div className="flex flex-col gap-4">
                          <button
                            onClick={() => handleDetectViolations(sections)}
                            disabled={narratorIsProcessing}
                            className="w-full bg-accent text-white py-6 rounded-3xl font-bold flex items-center justify-center gap-4 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-accent/20"
                          >
                            {narratorIsProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <AlertCircle className="w-6 h-6" />}
                            <div className="text-left">
                              <span className="block text-sm uppercase tracking-widest font-black">Step 4: Violation Audit</span>
                              <span className="block text-xs font-normal opacity-80">Detect structural overlaps, repetition, and factual errors.</span>
                            </div>
                          </button>
                          {steps.indexOf(maxReachedStep) > steps.indexOf("planned") && (
                            <button
                              onClick={goForward}
                              className="text-xs font-bold uppercase tracking-widest text-accent text-center py-2 hover:underline"
                            >
                              Skip to Conflict Detection →
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {currentNarratorStep === "detected" && mode === "outlining" && (
                      <div className="space-y-8 pt-10 border-t border-warm-ink/5">
                        <div className="bg-red-50/30 border-2 border-red-100/50 rounded-3xl p-8 space-y-6">
                          <div className="flex items-center gap-3 text-red-800 transition-all">
                            <AlertCircle className="w-6 h-6" />
                            <h4 className="text-sm font-black uppercase tracking-widest text-red-900">Forensic Audit & Correction Plan</h4>
                          </div>
                          
                          <EditableText 
                            label="Violation Audit" 
                            value={violationsAudit} 
                            onChange={setViolationsAudit}
                            multiline
                            markdown
                          />
                        </div>

                        <div className="flex flex-col gap-4">
                          <button
                            onClick={() => handleRefineOutlineAll(sections)}
                            disabled={narratorIsProcessing}
                            className="w-full bg-warm-ink text-warm-bg py-6 rounded-3xl font-bold flex items-center justify-center gap-4 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-warm-ink/20"
                          >
                            {narratorIsProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <PenTool className="w-6 h-6" />}
                            <div className="text-left">
                              <span className="block text-sm uppercase tracking-widest font-black">Step 5: Final Reconstruction</span>
                              <span className="block text-xs font-normal opacity-80">Apply forensic details and planning to rebuild the outline.</span>
                            </div>
                          </button>
                          {steps.indexOf(maxReachedStep) > steps.indexOf("detected") && (
                            <button
                              onClick={goForward}
                              className="text-xs font-bold uppercase tracking-widest text-accent text-center py-2 hover:underline"
                            >
                              Skip to Final Outline →
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {currentNarratorStep === "refined" && mode === "outlining" && (
                      <div className="space-y-8 pt-10 border-t border-warm-ink/5">
                        <div className="bg-amber-500/5 border-2 border-amber-500/15 rounded-3xl p-8 space-y-4">
                          <div className="flex items-center gap-3 text-amber-800">
                            <Sparkles className="w-6 h-6 animate-pulse" />
                            <h4 className="text-sm font-black uppercase tracking-widest text-amber-950 font-sans">Outline Successfully Reconstructed</h4>
                          </div>
                          <p className="text-xs text-warm-ink/70 leading-relaxed font-sans">
                            The storyline has been reorganized and chronological details have been woven in. Now, we must perform an **uncompromising forensic audit** to catch any lingering foreshadowing, psychological telegraphing, investigative framing, or digit formatting issues.
                          </p>
                        </div>

                        <div className="flex flex-col gap-4">
                          <button
                            onClick={() => handleCheckOutlineViolations(sections)}
                            disabled={narratorIsProcessing}
                            className="w-full bg-red-600 hover:bg-red-700 text-white py-6 rounded-3xl font-bold flex items-center justify-center gap-4 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-red-600/20"
                          >
                            {narratorIsProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <ListChecks className="w-6 h-6" />}
                            <div className="text-left">
                              <span className="block text-sm uppercase tracking-widest font-black">Step 6: Anti-Foreshadowing Audit</span>
                              <span className="block text-xs font-normal opacity-90">Deep chronological check to scan for subtle leaks, suspense breaks, or faith/trust telegraphing.</span>
                            </div>
                          </button>
                          {steps.indexOf(maxReachedStep) > steps.indexOf("refined") && (
                            <button
                              onClick={goForward}
                              className="text-xs font-bold uppercase tracking-widest text-accent text-center py-2 hover:underline"
                            >
                              Skip to Audit Report →
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {currentNarratorStep === "doublechecked" && mode === "outlining" && (
                      <div className="space-y-8 pt-10 border-t border-warm-ink/5">
                        <div className="bg-red-50/50 border-2 border-red-200/40 rounded-3xl p-8 space-y-6">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-red-900">
                              <AlertCircle className="w-6 h-6 text-red-700" />
                              <h4 className="text-sm font-black uppercase tracking-widest">Reconstructed Outline Vetting Report</h4>
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest bg-red-100 text-red-800 px-3 py-1 rounded-full">Report Ready</span>
                          </div>
                          
                          <EditableText 
                            label="Reconstructed Outline Violations Report" 
                            value={reconstructedOutlineViolationsReport} 
                            onChange={setReconstructedOutlineViolationsReport}
                            multiline
                            markdown
                          />
                        </div>

                        <div className="flex flex-col gap-4">
                          <button
                            onClick={() => handleCorrectOutlineViolations(sections)}
                            disabled={narratorIsProcessing}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-6 rounded-3xl font-bold flex items-center justify-center gap-4 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-emerald-600/20"
                          >
                            {narratorIsProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <PenTool className="w-6 h-6" />}
                            <div className="text-left">
                              <span className="block text-sm uppercase tracking-widest font-black">Step 7: Surgical Outline Purging & Correction</span>
                              <span className="block text-xs font-normal opacity-90">Rewrite the identified violating statements to remove faith/trust cues and other leaks while keeping 100% depth.</span>
                            </div>
                          </button>
                          {steps.indexOf(maxReachedStep) > steps.indexOf("doublechecked") && (
                            <button
                              onClick={goForward}
                              className="text-xs font-bold uppercase tracking-widest text-accent text-center py-2 hover:underline"
                            >
                              Skip to Corrected Outline →
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {currentNarratorStep === "corrected" && mode === "outlining" && (
                      <div className="space-y-8 pt-10 border-t border-warm-ink/5">
                        <div className="bg-emerald-500/5 border-2 border-emerald-500/15 rounded-3xl p-8 space-y-4">
                          <div className="flex items-center gap-3 text-emerald-800">
                            <CheckCircle2 className="w-6 h-6" />
                            <h4 className="text-sm font-black uppercase tracking-widest text-emerald-950 font-sans">Outline Purged & Finalized</h4>
                          </div>
                          <p className="text-xs text-warm-ink/70 leading-relaxed font-sans">
                            The outline has been completely vetted and all violations have been surgically removed! Foreshadowing, trust-telegraphing, numbers/digits, and clinical/investigative mentions have been fully neutralized. 
                          </p>
                          <p className="text-xs font-bold text-emerald-900 font-sans">
                            Each event preserves 100% of the historical, detailed facts.
                          </p>
                        </div>

                        <div className="bg-warm-ink/[0.02] border border-warm-ink/10 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                          <div className="space-y-1">
                            <h5 className="text-xs font-black uppercase tracking-widest text-warm-ink/60">Ready to Narrate?</h5>
                            <p className="text-[11px] text-warm-ink/40 font-sans">Flesh out the fully vetted outline sections with rich omniscient narratives.</p>
                          </div>
                          <button
                            onClick={() => {
                              setMode("narrate");
                              setCurrentNarratorStep("refined");
                            }}
                            className="bg-accent hover:bg-accent/90 text-white font-bold text-xs uppercase tracking-wider px-6 py-4 rounded-xl flex items-center gap-2 transition-all shadow-md active:scale-95"
                          >
                            <BookOpen className="w-4 h-4" />
                            Switch to Narrate Mode
                          </button>
                        </div>
                      </div>
                    )}

                    {currentNarratorStep === "refined" && mode === "narrate" && (
                      <div className="pt-6 border-t border-warm-ink/5 flex flex-col gap-6">
                        <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-[2rem] p-8 space-y-4">
                          <div className="flex items-center gap-3 text-emerald-800">
                            <Sparkles className="w-6 h-6" />
                            <h4 className="text-sm font-black uppercase tracking-widest text-emerald-950 font-sans">Research Verification for Narrate Mode</h4>
                          </div>
                          
                          <p className="text-xs text-warm-ink/75 leading-relaxed font-sans">
                            Each refined narrative segment needs a dedicated background research dossier to guide the story depth and enforce target word counts.
                          </p>

                          {sections.some(s => !s.researchBrief) ? (
                            <div className="text-xs font-bold text-amber-800 bg-amber-500/10 p-4 rounded-2xl border border-amber-500/10 flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              <div>
                                <span className="block font-black uppercase tracking-wider text-[10px] mb-0.5">Missing Dossiers Detected</span>
                                Some or all of your refined segments lack dedicated background facts. Narrator will not be able to write rich stories!
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs font-bold text-emerald-800 bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/10 flex items-start gap-2">
                              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              <div>
                                <span className="block font-black uppercase tracking-wider text-[10px] mb-0.5">All Dossiers Connected</span>
                                Every segment has an associated factual research dossier. Narrator is ready to create full-length, highly comprehensive chapters.
                              </div>
                            </div>
                          )}

                          <div className="flex flex-wrap gap-4 pt-2">
                            <button
                              onClick={() => {
                                setSections(prev => prev.map(s => ({ ...s, researchBrief: "" })));
                                setCurrentNarratorStep("parsed");
                              }}
                              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-md hover:scale-[1.02]"
                            >
                              Run Deep Research on Refined Outline
                            </button>
                            {sections.some(s => !s.researchBrief) && (
                              <button
                                onClick={() => {
                                  setCurrentNarratorStep("parsed");
                                }}
                                className="px-6 py-3 bg-warm-ink/5 hover:bg-warm-ink/10 text-warm-ink rounded-2xl text-xs font-black uppercase tracking-wider transition-all"
                              >
                                Select Research Source & Configure
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Suspense Declaration */}
                  {suspenseDeclaration && (
                    <div className="mb-12 bg-purple-50/50 border border-purple-100/50 rounded-3xl p-8 space-y-6">
                      <div className="flex items-center gap-3 text-purple-800">
                        <Sparkles className="w-5 h-5" />
                        <h3 className="text-xl font-serif font-bold italic tracking-tight">Suspense Strategy</h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-widest text-purple-400 block mb-1">Primary Type</span>
                            <EditableText 
                              label="Primary Type" 
                              value={suspenseDeclaration.primaryType} 
                              onChange={(v) => setSuspenseDeclaration({...suspenseDeclaration, primaryType: v})}
                              className="text-sm font-bold text-purple-900 bg-purple-200/50 px-3 py-1 rounded-full inline-block"
                            />
                          </div>
                          {suspenseDeclaration.secondaryType && (
                            <div>
                              <span className="text-[10px] uppercase font-black tracking-widest text-purple-400 block mb-1">Secondary Type</span>
                              <EditableText 
                                label="Secondary Type" 
                                value={suspenseDeclaration.secondaryType} 
                                onChange={(v) => setSuspenseDeclaration({...suspenseDeclaration, secondaryType: v})}
                                className="text-sm font-bold text-purple-900 bg-purple-200/50 px-3 py-1 rounded-full inline-block"
                              />
                            </div>
                          )}
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-widest text-purple-400 block mb-1">Reveal Window</span>
                            <EditableText 
                              label="Reveal Window" 
                              value={suspenseDeclaration.revealWindow} 
                              onChange={(v) => setSuspenseDeclaration({...suspenseDeclaration, revealWindow: v})}
                              className="text-sm text-purple-900 font-medium"
                            />
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-widest text-purple-400 block mb-1">Withheld Information</span>
                            <EditableText 
                              label="Withheld Information" 
                              value={suspenseDeclaration.withheldInformation} 
                              onChange={(v) => setSuspenseDeclaration({...suspenseDeclaration, withheldInformation: v})}
                              className="text-sm text-purple-900 leading-relaxed font-medium"
                              multiline
                            />
                          </div>
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-widest text-purple-400 block mb-1">Strict Exclusions</span>
                            <EditableText 
                              label="Strict Exclusions" 
                              value={suspenseDeclaration.strictExclusions} 
                              onChange={(v) => setSuspenseDeclaration({...suspenseDeclaration, strictExclusions: v})}
                              className="text-sm text-purple-800/70 leading-relaxed italic border-l-2 border-purple-200 pl-4"
                              multiline
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Sections List */}
                  <div className="space-y-12">
                    {sections.map((section, idx) => (
                      <div key={idx} className="relative pl-12 border-l-2 border-warm-ink/5 space-y-6 group">
                        <div className="absolute -left-[13px] top-0 w-6 h-6 bg-warm-bg border-4 border-accent rounded-full group-hover:scale-125 transition-transform" />
                        
                        <div className="flex items-start justify-between">
                          <div className="space-y-4 w-full">
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-black text-accent bg-accent/5 px-2 py-0.5 rounded border border-accent/10">SECTION {section.sectionNumber || idx + 1}</span>
                                <EditableText 
                                  label="Title" 
                                  value={section.title} 
                                  onChange={(v) => updateSection(section.id, { title: v })}
                                  className="text-2xl font-serif font-bold text-warm-ink"
                                />
                              </div>
                              
                              <div className="flex flex-wrap items-center gap-4 py-2 border-y border-warm-ink/5">
                                {section.timePeriod && (
                                  <div className="flex items-center gap-1.5 px-3 py-1 bg-warm-ink/5 rounded-full">
                                    <Clock className="w-3 h-3 text-warm-ink/40" />
                                    <EditableText 
                                      label="Time Period" 
                                      value={section.timePeriod} 
                                      onChange={(v) => updateSection(section.id, { timePeriod: v })}
                                      className="text-[10px] font-bold text-warm-ink/60 uppercase tracking-widest"
                                    />
                                  </div>
                                )}
                                {section.narrativeBeat && (
                                  <div className="flex items-center gap-1.5 px-3 py-1 bg-accent/5 rounded-full">
                                    <PlayCircle className="w-3 h-3 text-accent/40" />
                                    <EditableText 
                                      label="Narrative Beat" 
                                      value={section.narrativeBeat} 
                                      onChange={(v) => updateSection(section.id, { narrativeBeat: v })}
                                      className="text-[10px] font-bold text-accent uppercase tracking-widest"
                                    />
                                  </div>
                                )}
                                <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 rounded-full border border-amber-100">
                                  <Sparkles className="w-3 h-3 text-amber-500" />
                                  <EditableText 
                                    label="Word Count Target" 
                                    value={String(section.wordCountTarget || section.estimatedWordCount || 500)} 
                                    onChange={(v) => updateSection(section.id, { wordCountTarget: parseInt(v) || 500, estimatedWordCount: parseInt(v) || 500 })}
                                    className="text-[10px] font-bold text-amber-700 uppercase tracking-widest"
                                  />
                                  <span className="text-[10px] font-bold text-amber-700/40 uppercase tracking-widest">WORDS</span>
                                </div>
                                <span className={`text-[10px] font-bold uppercase tracking-widest ${section.actualWordCount ? (section.actualWordCount >= (section.wordCountTarget || section.estimatedWordCount || 0) * 0.9 ? 'text-green-600' : 'text-amber-600') : 'text-accent opacity-60'}`}>
                                  {section.actualWordCount && (
                                    <>
                                      {section.actualWordCount} / {section.wordCountTarget || section.estimatedWordCount} Actual
                                    </>
                                  )}
                                </span>
                              </div>

                              {section.primaryFocus && (
                                <div className="bg-warm-bg p-4 border border-warm-ink/5 rounded-2xl">
                                  <span className="text-[9px] uppercase font-black text-warm-ink/30 block mb-1">Primary Focus</span>
                                  <EditableText 
                                    label="Primary Focus" 
                                    value={section.primaryFocus} 
                                    onChange={(v) => updateSection(section.id, { primaryFocus: v })}
                                    className="text-sm text-warm-ink/80 font-medium italic"
                                    multiline
                                  />
                                </div>
                              )}

                              {(section.startEvent || section.endEvent) && (
                                <div className="grid grid-cols-2 gap-4">
                                  {section.startEvent && (
                                    <div className="space-y-1">
                                      <span className="text-[9px] uppercase font-black text-green-600/40 block">Start Event</span>
                                      <EditableText 
                                        label="Start Event" 
                                        value={section.startEvent} 
                                        onChange={(v) => updateSection(section.id, { startEvent: v })}
                                        className="text-[11px] text-warm-ink/60 leading-tight"
                                        multiline
                                      />
                                    </div>
                                  )}
                                  {section.endEvent && (
                                    <div className="space-y-1">
                                      <span className="text-[9px] uppercase font-black text-red-600/40 block">End Event</span>
                                      <EditableText 
                                        label="End Event" 
                                        value={section.endEvent} 
                                        onChange={(v) => updateSection(section.id, { endEvent: v })}
                                        className="text-[11px] text-warm-ink/60 leading-tight"
                                        multiline
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {(getNormalizedEvents(section).length > 0) && (
                              <div className="space-y-4 bg-white/60 p-6 rounded-[2rem] border border-warm-ink/5 shadow-sm">
                                <div className="flex items-center justify-between border-b border-warm-ink/5 pb-2">
                                  <h5 className="text-[10px] font-black uppercase tracking-[0.25em] text-accent flex items-center gap-2">
                                    <ListChecks className="w-4 h-4 text-accent" />
                                    Chronological Key Events ({ getNormalizedEvents(section).length } dense beats)
                                  </h5>
                                </div>

                                <div className="space-y-3 font-sans">
                                  {getNormalizedEvents(section).map((bullet: string, bIdx: number) => (
                                    <div 
                                      key={bIdx}
                                      className="flex gap-4 items-start bg-warm-bg/30 hover:bg-white p-5 rounded-2xl border border-warm-ink/5 shadow-sm hover:shadow-md transition-all group duration-200"
                                    >
                                      <div className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 text-accent font-mono text-[11px] font-bold select-none">
                                        {bIdx + 1}
                                      </div>
                                      <div className="flex-1 w-full">
                                        <EditableText 
                                          label={`Key Event ${bIdx + 1}`}
                                          value={bullet}
                                          onChange={(newVal) => {
                                            const updated = getNormalizedEvents(section).slice();
                                            updated[bIdx] = newVal;
                                            updateSection(section.id, { keyEvents: updated, bullets: updated });
                                          }}
                                          className="text-sm text-warm-ink/90 leading-relaxed font-sans w-full"
                                          multiline
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                <div className="pt-2 border-t border-dashed border-warm-ink/10">
                                  <EditableText 
                                    label="Edit Key Events (Strictly one dense paragraph beat per line)" 
                                    value={getNormalizedEvents(section).join("\n")} 
                                    onChange={(v) => {
                                      const lines = v.split("\n").filter(l => l.trim());
                                      updateSection(section.id, { keyEvents: lines, bullets: lines });
                                    }}
                                    customPreview={
                                      <div className="flex items-center gap-2 text-accent/70 hover:text-accent font-bold text-xs uppercase tracking-wider py-1.5 px-3 bg-accent/5 hover:bg-accent/10 rounded-xl transition-all cursor-pointer w-fit select-none border border-accent/10">
                                        <Edit3 className="w-3.5 h-3.5" />
                                        Click to Edit / Add Key Events List
                                      </div>
                                    }
                                    className="border-none hover:bg-transparent p-0 m-0"
                                    multiline
                                  />
                                </div>
                              </div>
                            )}

                            {(section.whatNotToInclude || (section.exclusions && section.exclusions.length > 0)) && (
                              <div className="space-y-2 bg-red-50/30 p-4 rounded-2xl border border-red-100/50">
                                <h5 className="text-[9px] font-black uppercase tracking-widest text-red-800/40 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <AlertCircle className="w-3 h-3" />
                                    Suspense Exclusions (Edit as list)
                                  </div>
                                </h5>
                                <EditableText 
                                  label="Suspense Exclusions (Enter per line)" 
                                  value={(section.whatNotToInclude || section.exclusions || []).join("\n")} 
                                  onChange={(v) => updateSection(section.id, { whatNotToInclude: v.split("\n").filter(l => l.trim()) })}
                                  className="text-[11px] text-red-950/60 italic"
                                  multiline
                                />
                              </div>
                            )}

                            {/* Real-time Section Outline Word Count */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-warm-ink/5 border border-warm-ink/10 rounded-[2.5rem] mt-6 shadow-sm hover:shadow transition-shadow">
                              <div className="flex items-center gap-2.5">
                                <Sparkles className="w-5 h-5 text-accent animate-pulse" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-warm-ink/40">Outline Verification Summary</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-warm-ink/80 font-sans">
                                <div>
                                  Key Events: <span className="font-mono font-black text-accent">{getOutlineSectionKeyEventsWordCount(section)}</span> words
                                </div>
                                <div className="text-warm-ink/20">|</div>
                                <div>
                                  Total Section Outline: <span className="font-mono font-black text-accent">{getOutlineSectionWordCount(section)}</span> words
                                </div>
                              </div>
                            </div>
                          </div>

                          {section.researchBrief && !section.narrative && mode === "narrate" && (
                            <button
                              onClick={() => handleNarrateSection(idx)}
                              disabled={narratingIndex !== null || narratorIsProcessing}
                              className="bg-warm-ink text-warm-bg px-6 py-3 rounded-full text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-accent transition-colors disabled:opacity-30"
                            >
                              {narratingIndex === idx ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenTool className="w-4 h-4" />}
                              Write Narrative
                            </button>
                          )}
                        </div>

                        {/* Research Brief Dropdown */}
                        {section.researchBrief && (
                          <div className="bg-accent/[0.03] border border-accent/10 rounded-3xl p-6 text-sm text-warm-ink/60 font-sans leading-relaxed">
                            <h5 className="text-[10px] font-bold uppercase tracking-widest text-accent flex items-center justify-between group-hover:text-accent/80 transition-colors">
                               <span className="flex items-center gap-2">
                                {researchingIndex === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                                Research Brief
                               </span>
                               <button 
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   setCollapsedResearch(prev => ({ ...prev, [section.id]: !prev[section.id] }));
                                 }}
                                 className="p-1 hover:bg-accent/10 rounded-md transition-colors"
                               >
                                 {collapsedResearch[section.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                               </button>
                             </h5>
                             {!collapsedResearch[section.id] && (
                               <motion.div 
                                 initial={{ height: 0, opacity: 0 }}
                                 animate={{ height: "auto", opacity: 1 }}
                                 className="prose prose-sm prose-warm-ink mt-3"
                               >
                                 <Markdown>{section.researchBrief}</Markdown>
                               </motion.div>
                             )}
                          </div>
                        )}

                        {/* Narrative Output */}
                        {section.narrative && (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between px-6">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-warm-ink/30">Narrative Version</span>
                                <div className="flex items-center gap-1 bg-warm-ink/5 p-1 rounded-lg">
                                  {(section.narrativeVersions || [section.narrative]).map((_, vIdx) => (
                                    <button
                                      key={vIdx}
                                      onClick={() => handleSelectNarrativeVersion(section.id, vIdx)}
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                                        (section.selectedNarrativeIndex ?? 0) === vIdx
                                          ? 'bg-accent text-white shadow-sm'
                                          : 'text-warm-ink/40 hover:bg-warm-ink/10'
                                      }`}
                                    >
                                      V{vIdx + 1}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <button
                                onClick={() => handleRewriteNarrativeClick(idx)}
                                disabled={narratingIndex !== null}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/5 hover:bg-accent hover:text-white text-accent rounded-full text-[10px] font-bold uppercase transition-all disabled:opacity-30"
                              >
                                <Wand2 className="w-3 h-3" />
                                Rewrite Section
                              </button>
                            </div>

                            <div className="bg-white border border-warm-ink/5 rounded-3xl p-10 shadow-sm relative group/story">
                              <EditableText 
                                label="Generated Narrative" 
                                value={section.narrative} 
                                onChange={(v) => {
                                  const count = wordCount(v);
                                  updateSection(section.id, { narrative: v, actualWordCount: count });
                                }}
                                className="story-content font-serif text-xl text-warm-ink leading-relaxed"
                                multiline
                                markdown
                              />
                              <button
                                onClick={() => copyToClipboard(section.narrative || "")}
                                className="absolute top-6 right-6 p-2 h-10 w-10 bg-warm-ink/5 hover:bg-accent hover:text-white rounded-full opacity-0 group-hover/story:opacity-100 transition-all flex items-center justify-center"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    <div className="pt-12 text-center">
                       <button
                         onClick={() => {
                           setOutlineText("");
                           setSections([]);
                           setSuspenseDeclaration(null);
                           setCurrentNarratorStep("idle");
                           setNarratorChatHistory([]);
                         }}
                         className="text-xs font-bold uppercase tracking-[0.2em] text-warm-ink/20 hover:text-accent font-sans transition-colors"
                       >
                         Discard Outline and Start New
                       </button>
                    </div>
                  </div>
                </section>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* History / Protocol Notes */}
        {mode === "retell" && !retoldText && !isProcessing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-12"
          >
            <div className="p-8 rounded-3xl bg-warm-ink/[0.02] border border-warm-ink/5 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-accent flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border border-accent flex items-center justify-center text-[10px]">1</span>
                Absorb
              </h3>
              <p className="text-sm text-warm-ink/60 leading-relaxed">
                The engine reads the entire piece, identifies the core events, stakeholders, and emotional stakes.
              </p>
            </div>
            <div className="p-8 rounded-3xl bg-warm-ink/[0.02] border border-warm-ink/5 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-accent flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border border-accent flex items-center justify-center text-[10px]">2</span>
                Rebuild
              </h3>
              <p className="text-sm text-warm-ink/60 leading-relaxed">
                The original sentence structures are discarded. The story is retold from scratch using simple, modern spoken English.
              </p>
            </div>
            <div className="p-8 rounded-3xl bg-warm-ink/[0.02] border border-warm-ink/5 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-accent flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border border-accent flex items-center justify-center text-[10px]">3</span>
                Verify
              </h3>
              <p className="text-sm text-warm-ink/60 leading-relaxed">
                The retelling is checked against the 5-word rule: no more than 3-5 consecutive words may match the original.
              </p>
            </div>
          </motion.div>
        )}
      </main>

      <footer className="pt-24 pb-12 border-t border-warm-ink/5 text-center text-[10px] uppercase tracking-[0.2em] font-bold text-warm-ink/20">
        Built for Absolute Clarity • Protocol v1.4.2
      </footer>

      {/* Import Modal */}
      <AnimatePresence>
        {isImporting && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsImporting(false)}
              className="absolute inset-0 bg-warm-ink/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-warm-bg rounded-[2.5rem] shadow-2xl p-8 space-y-6 border border-warm-ink/10"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-serif font-bold text-warm-ink">Resume Story</h3>
                  <p className="text-sm text-warm-ink/40 font-sans">Paste your previously retold text below to seed the memory bank.</p>
                </div>
                <button 
                  onClick={() => setIsImporting(false)}
                  className="p-2 hover:bg-warm-ink/5 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-warm-ink/40" />
                </button>
              </div>

              <textarea
                className="w-full h-80 p-6 bg-white border border-warm-ink/10 rounded-3xl focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none font-serif text-lg leading-relaxed placeholder:text-warm-ink/20"
                placeholder="Paste the retold version here..."
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />

              <div className="flex justify-end gap-3 pt-2">
                <button 
                  onClick={() => setIsImporting(false)}
                  className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-warm-ink/40 hover:text-warm-ink transition-colors"
                >
                  Cancel
                </button>
                <button 
                  disabled={!importText.trim()}
                  onClick={handleImport}
                  className="bg-accent text-white px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100 shadow-lg shadow-accent/20"
                >
                  Import and Continue
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reset Confirmation Modal */}
      <AnimatePresence>
        {isConfirmingNewStory && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 text-center">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsConfirmingNewStory(false)}
              className="absolute inset-0 bg-warm-ink/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-warm-bg rounded-[2rem] shadow-2xl p-8 space-y-6 border border-warm-ink/10"
            >
              <div className="space-y-2">
                <div className="w-12 h-12 bg-accent/10 text-accent rounded-full flex items-center justify-center mx-auto mb-4">
                  <RotateCcw className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-serif font-bold text-warm-ink">Start a New Story?</h3>
                <p className="text-sm text-warm-ink/60 font-sans">This will clear your current retelling progress. This action cannot be undone.</p>
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <button 
                  onClick={executeReset}
                  className="w-full bg-accent text-white px-8 py-4 rounded-full font-bold hover:scale-[1.02] transition-transform shadow-lg shadow-accent/20"
                >
                  Yes, Clear Everything
                </button>
                <button 
                  onClick={() => setIsConfirmingNewStory(false)}
                  className="w-full px-8 py-4 text-xs font-bold uppercase tracking-widest text-warm-ink/40 hover:text-warm-ink transition-colors"
                >
                  No, Keep My Story
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Narrative Rewrite Modal */}
      <AnimatePresence>
        {isRewriteModalOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsRewriteModalOpen(false)}
              className="absolute inset-0 bg-warm-ink/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-warm-bg rounded-[2.5rem] shadow-2xl p-8 space-y-6 border border-warm-ink/10"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-accent/10 flex items-center justify-center">
                    <Wand2 className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-xl font-serif font-bold text-warm-ink">Rewrite Section</h3>
                    <p className="text-xs text-warm-ink/40 uppercase tracking-widest font-black">Section {sections[sectionToRewriteIdx!]?.sectionNumber || (sectionToRewriteIdx! + 1)}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsRewriteModalOpen(false)}
                  className="p-2 hover:bg-warm-ink/5 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-warm-ink/40" />
                </button>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-accent block">What should be different? (Optional)</label>
                <textarea
                  className="w-full h-40 p-6 bg-white border border-warm-ink/10 rounded-3xl focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none font-sans text-sm leading-relaxed placeholder:text-warm-ink/20 resize-none shadow-inner"
                  placeholder="e.g., 'Make it more suspenseful', 'Correct the timeline of events', 'Focus more on the daughter's reaction'..."
                  value={rewriteFeedback}
                  onChange={(e) => setRewriteFeedback(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button 
                  onClick={() => setIsRewriteModalOpen(false)}
                  className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-warm-ink/40 hover:text-warm-ink transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={executeRewriteNarrative}
                  className="bg-accent text-white px-10 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-accent/20"
                >
                  <Sparkles className="w-4 h-4" />
                  Rewrite Now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
