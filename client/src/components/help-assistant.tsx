import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { HelpCircle, Send, Loader2, BookOpen, ArrowRight, Sparkles } from "lucide-react";

interface HelpMessage {
  role: "user" | "assistant";
  content: string;
  relatedSections?: { id: string; title: string }[];
  suggestedPages?: { label: string; path: string }[];
}

interface HelpAnswer {
  answer: string;
  relatedSections: { id: string; title: string }[];
  suggestedPages: { label: string; path: string }[];
  source: "ai" | "guide";
}

const SUGGESTED_QUESTIONS = [
  "How do I connect my broker?",
  "How does InstaTrade order review work?",
  "How do I set my risk limits?",
  "How do I protect a position with a trailing stop?",
  "What do the A+/A/B/C grades mean?",
];

export function HelpAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const askMutation = useMutation({
    mutationFn: async (question: string) => {
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const res = await apiRequest("POST", "/api/help/ask", { question, history });
      return (await res.json()) as HelpAnswer;
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          relatedSections: data.relatedSections,
          suggestedPages: data.suggestedPages,
        },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry — I couldn't answer that right now. Please try again, or open the User Guide.",
          suggestedPages: [{ label: "User Guide", path: "/guide" }],
        },
      ]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, askMutation.isPending]);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || askMutation.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setInput("");
    askMutation.mutate(q);
  };

  return (
    <>
      {createPortal(
        <Button
          size="icon"
          className="fixed z-50 h-11 w-11 rounded-full shadow-lg ring-2 ring-background"
          style={{
            right: "max(1rem, env(safe-area-inset-right))",
            top: "max(4.5rem, calc(env(safe-area-inset-top) + 4.5rem))",
            left: "auto",
            bottom: "auto",
          }}
          onClick={() => setOpen(true)}
          aria-label="Open help assistant"
          data-testid="button-open-help-assistant"
        >
          <HelpCircle className="h-5 w-5" />
        </Button>,
        document.body,
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex flex-col w-full sm:max-w-md p-0">
          <SheetHeader className="px-4 pt-4 pb-2 border-b">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> Help Assistant
            </SheetTitle>
            <SheetDescription className="text-xs">
              Ask anything about using VCP Trader AI. Answers come from the User Guide — not investment advice.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 px-4">
            <div className="py-3 space-y-3">
              {messages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Try one of these:</p>
                  <div className="flex flex-col gap-2">
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <Button
                        key={q}
                        variant="outline"
                        size="sm"
                        className="justify-start h-auto py-2 text-left whitespace-normal"
                        onClick={() => ask(q)}
                        data-testid={`button-help-suggested-${q.slice(0, 20).replace(/\W+/g, "-").toLowerCase()}`}
                      >
                        {q}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm"
                        : "max-w-[90%] rounded-lg bg-muted px-3 py-2 text-sm space-y-2"
                    }
                    data-testid={`text-help-message-${i}`}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.role === "assistant" && (m.relatedSections?.length || m.suggestedPages?.length) ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {m.relatedSections?.map((s) => (
                          <Link key={s.id} href={`/guide/${s.id}`} onClick={() => setOpen(false)}>
                            <Badge
                              variant="secondary"
                              className="cursor-pointer gap-1"
                              data-testid={`link-help-guide-${s.id}`}
                            >
                              <BookOpen className="h-3 w-3" /> {s.title}
                            </Badge>
                          </Link>
                        ))}
                        {m.suggestedPages?.map((p) => (
                          <Link key={p.path} href={p.path} onClick={() => setOpen(false)}>
                            <Badge
                              variant="outline"
                              className="cursor-pointer gap-1"
                              data-testid={`link-help-page-${p.label.replace(/\W+/g, "-").toLowerCase()}`}
                            >
                              {p.label} <ArrowRight className="h-3 w-3" />
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}

              {askMutation.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          <form
            className="flex items-center gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about the app…"
              maxLength={500}
              data-testid="input-help-question"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || askMutation.isPending}
              aria-label="Send question"
              data-testid="button-help-send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
