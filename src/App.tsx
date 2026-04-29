/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Content, HarmCategory, HarmBlockThreshold } from "@google/genai";
import mammoth from "mammoth";
import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { Copy, History, Loader2, RotateCcw, Sparkles, Wand2, PlusCircle, Import, X, Trash2, RefreshCcw, ChevronLeft, ChevronRight, BookOpen, PenTool, Search, LayoutList, FileText, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import Markdown from "react-markdown";
import { RETELLING_PROTOCOL } from "./constants/protocol";
import { NARRATION_PROTOCOL, OUTLINE_PARSING_PROTOCOL, RESEARCH_PROTOCOL } from "./constants/narrator_protocols";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const STORAGE_KEY = "absolute_reteller_session";

interface StoryPart {
  original: string;
  versions: string[];
  selectedIndex: number;
}

const NARRATOR_STORAGE_KEY = "absolute_narrator_session";

type AppMode = "retell" | "narrate";

interface NarrativeSection {
  id: string;
  title: string;
  description?: string;
  bullets: string[];
  exclusions: string[];
  estimatedWordCount: number;
  originalWordCountRange?: string;
  emotionalArc?: string;
  writerNotes?: string[];
  actualWordCount?: number;
  researchBrief?: string;
  narrative?: string;
}

const STORY_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

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
  const [narratorIsProcessing, setNarratorIsProcessing] = useState(false);
  const [currentNarratorStep, setCurrentNarratorStep] = useState<"idle" | "parsed" | "researched" | "narrating">("idle");
  const [narratorChatHistory, setNarratorChatHistory] = useState<Content[]>([]);
  const [narratingIndex, setNarratingIndex] = useState<number | null>(null);
  const [researchingIndex, setResearchingIndex] = useState<number | null>(null);
  const [collapsedResearch, setCollapsedResearch] = useState<Record<string, boolean>>({});
  
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
        const { sections: savedSections, step, history } = JSON.parse(savedNarrate);
        if (savedSections) setSections(savedSections);
        if (step) setCurrentNarratorStep(step);
        if (history) setNarratorChatHistory(history);
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
      history: narratorChatHistory
    }));
  }, [sections, currentNarratorStep, narratorChatHistory]);

  // --- Narrator Logic ---

  const handleParseOutline = async () => {
    if (!outlineText.trim() && !outlineFile) return;
    setNarratorIsProcessing(true);
    setError(null);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
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
      confetti({ particleCount: 50, spread: 30, colors: ["#d97706"] });
    } catch (err) {
      console.error(err);
      setError("Failed to parse outline. Ensure it follows a clear section structure.");
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
      const updatedSections = [...sections];
      
      for (let i = 0; i < updatedSections.length; i++) {
        setResearchingIndex(i);
        const section = updatedSections[i];
        
        const response = await ai.models.generateContent({
          model: "gemini-3.1-pro-preview", // User requested 3.1 Pro for research
          contents: {
            text: `[FULL STORY OUTLINE]\n${outlineText}\n\n[TARGET SECTION FOR RESEARCH]\nSection Title: "${section.title}"\nSection Description: "${section.description || ''}"\nBullets: ${section.bullets.join(", ")}`
          },
          config: {
            systemInstruction: RESEARCH_PROTOCOL,
            temperature: 0.2,
            topP: 0.9,
            thinkingConfig: { thinkingBudget: 32768 }, // Max budget for deep research as requested
            safetySettings: STORY_SAFETY_SETTINGS
          }
        });

        updatedSections[i] = { ...section, researchBrief: response.text || "" };
        setSections([...updatedSections]); 
      }

      setCurrentNarratorStep("researched");
      confetti({ particleCount: 100, spread: 50, colors: ["#d97706"] });
    } catch (err) {
      console.error(err);
      setError("Failed during research phase. Please try again.");
    } finally {
      setResearchingIndex(null);
      setNarratorIsProcessing(false);
    }
  };

  const handleNarrateSection = async (index: number) => {
    const section = sections[index];
    if (!section || !section.researchBrief) return;

    setNarratingIndex(index);
    setError(null);

    try {
      const prompt = `
        SECTION TO NARRATE: ${section.title}
        RESEARCH BRIEF: ${section.researchBrief}
        BULLETS: ${section.bullets.join("\n- ")}
        EXCLUSIONS: ${section.exclusions.join("\n- ")}
        TARGET WORD COUNT: ${section.estimatedWordCount}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview", 
        contents: { text: prompt },
        config: {
          systemInstruction: NARRATION_PROTOCOL,
          temperature: 0.9, 
          topP: 0.95,
          thinkingConfig: { thinkingBudget: 32768 }, 
          safetySettings: STORY_SAFETY_SETTINGS
        }
      });

      const result = response.text || "";
      const actualCount = wordCount(result);

      setSections(prev => {
        const next = [...prev];
        next[index] = { 
          ...next[index], 
          narrative: result,
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

  // --- End Narrator Logic ---

  const handleRetell = useCallback(async () => {
    if (!inputText.trim()) return;

    setIsProcessing(true);
    setError(null);

    try {
      const chat = ai.chats.create({
        model: "gemini-3.1-pro-preview",
        config: {
          systemInstruction: RETELLING_PROTOCOL,
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
      : sections.map(s => s.narrative).filter(Boolean).join("\n\n");
    
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
            : "Transform sparse outlines into deep, professional narratives using structured research."
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
                      <button 
                        onClick={copyAll}
                        className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest bg-accent text-white px-6 py-3 rounded-full hover:scale-105 transition-transform shadow-lg shadow-accent/20"
                      >
                        <Copy className="w-4 h-4" />
                        Copy Entire Story
                      </button>
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
                <section className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs uppercase tracking-widest font-bold text-warm-ink/50 flex items-center gap-2">
                      <span className="w-8 h-[1px] bg-warm-ink/20"></span>
                      Story Outline (Document or Text)
                    </h2>
                    <div className="flex items-center gap-4">
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
                      className="w-full h-96 p-8 bg-white border border-warm-ink/10 rounded-3xl shadow-sm focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none transition-all font-sans text-lg leading-relaxed resize-none"
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

              {/* Research & Narration Phase */}
              {sections.length > 0 && (
                <section className="space-y-12">
                  {/* Summary Card */}
                  <div className="bg-white border border-warm-ink/10 rounded-[2.5rem] p-10 shadow-xl space-y-8">
                    <div className="flex items-center justify-between">
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-accent/10 flex items-center justify-center">
                            <CheckCircle2 className="w-6 h-6 text-accent" />
                          </div>
                          <div>
                            <h3 className="text-2xl font-serif font-bold text-warm-ink">Outline Verified</h3>
                            <p className="text-xs text-warm-ink/40 font-sans tracking-wide">Ready for research and narration</p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <button 
                            onClick={copyAll}
                            disabled={sections.every(s => !s.narrative)}
                            className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest bg-accent text-white px-6 py-3 rounded-full hover:scale-105 active:scale-95 transition-all shadow-lg shadow-accent/20 disabled:opacity-30 disabled:hover:scale-100"
                          >
                            <Copy className="w-4 h-4" />
                            Copy Full Narrative
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <div className="text-center p-5 bg-warm-ink/5 rounded-[2rem] border border-warm-ink/5 min-w-[120px]">
                          <div className="text-3xl font-serif font-bold text-accent">{sections.length}</div>
                          <div className="text-[10px] uppercase font-bold text-warm-ink/30 tracking-widest">Sections</div>
                        </div>
                        <div className="text-center p-5 bg-warm-ink/5 rounded-[2rem] border border-warm-ink/5 min-w-[160px]">
                          <div className="text-2xl font-serif font-bold text-accent whitespace-nowrap">
                            {totalActualWords.toLocaleString()} <span className="text-xs text-warm-ink/40 font-sans font-normal">/ {totalEstimatedWords.toLocaleString()}</span>
                          </div>
                          <div className="text-[10px] uppercase font-bold text-warm-ink/30 tracking-widest">Total Word Count</div>
                        </div>
                      </div>
                    </div>

                    {currentNarratorStep === "parsed" && (
                      <div className="pt-6 border-t border-warm-ink/5">
                        <button
                          onClick={handleResearchAll}
                          disabled={narratorIsProcessing}
                          className="w-full bg-accent text-white py-6 rounded-3xl font-bold flex items-center justify-center gap-4 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-accent/20"
                        >
                          {narratorIsProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Search className="w-6 h-6" />}
                          <div className="text-left">
                            <span className="block text-sm uppercase tracking-widest font-black">Step 2: Start Deep Research</span>
                            <span className="block text-xs font-normal opacity-80">Flesh out bullets with detail for all {sections.length} sections.</span>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Sections List */}
                  <div className="space-y-12">
                    {sections.map((section, idx) => (
                      <div key={idx} className="relative pl-12 border-l-2 border-warm-ink/5 space-y-6 group">
                        <div className="absolute -left-[13px] top-0 w-6 h-6 bg-warm-bg border-4 border-accent rounded-full group-hover:scale-125 transition-transform" />
                        
                        <div className="flex items-start justify-between">
                          <div className="space-y-2">
                            <h4 className="text-2xl font-serif font-bold text-warm-ink">{section.title}</h4>
                            {section.description && (
                              <p className="text-sm text-warm-ink/60 font-sans italic">{section.description}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-4">
                              <span className={`text-[10px] font-bold uppercase tracking-widest ${section.actualWordCount ? (section.actualWordCount >= section.estimatedWordCount * 0.9 ? 'text-green-600' : 'text-amber-600') : 'text-accent opacity-60'}`}>
                                {section.actualWordCount ? (
                                  <>
                                    {section.actualWordCount} / {section.estimatedWordCount} Words
                                    <span className="ml-2 opacity-40">({Math.round((section.actualWordCount / section.estimatedWordCount) * 100)}%)</span>
                                  </>
                                ) : (
                                  `Target: ${section.originalWordCountRange || `${section.estimatedWordCount} words`}`
                                )}
                              </span>
                              {section.emotionalArc && (
                                <span className="text-[10px] font-bold text-purple-600/60 uppercase tracking-widest flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" />
                                  Arc: {section.emotionalArc}
                                </span>
                              )}
                            </div>
                            {section.writerNotes && section.writerNotes.length > 0 && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {section.writerNotes.map((note, nIdx) => (
                                  <span key={nIdx} className="text-[9px] bg-warm-ink/5 text-warm-ink/40 px-2 py-1 rounded-md border border-warm-ink/5">
                                    {note}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {section.researchBrief && !section.narrative && (
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
                          <div className="bg-white border border-warm-ink/5 rounded-3xl p-10 shadow-sm relative group/story">
                            <div className="story-content font-serif text-xl text-warm-ink leading-relaxed">
                              <Markdown>{section.narrative}</Markdown>
                            </div>
                            <button
                              onClick={() => copyToClipboard(section.narrative || "")}
                              className="absolute top-6 right-6 p-2 h-10 w-10 bg-warm-ink/5 hover:bg-accent hover:text-white rounded-full opacity-0 group-hover/story:opacity-100 transition-all flex items-center justify-center"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}

                    <div className="pt-12 text-center">
                       <button
                         onClick={() => {
                           setOutlineText("");
                           setSections([]);
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
    </div>
  );
}
