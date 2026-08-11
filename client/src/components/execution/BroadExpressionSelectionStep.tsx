/**
 * client/src/components/execution/BroadExpressionSelectionStep.tsx — Sprint 2.8.1A
 *
 * "How would you like to explore this opportunity?" step.
 * Shown as the first step in Trade Planning, before family-level selection.
 *
 * COMPLIANCE:
 * - No "AI Recommended", "Best Strategy", "Suitable for You"
 * - User explicitly selects — no auto-selection from preferences
 * - Preferences control ordering and highlighting only
 * - All compatibility reasons shown transparently
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ChevronRight, Info, Star, CheckCircle2 } from "lucide-react";
import {
  EXPRESSION_SELECTION_DISCLAIMER,
  EXPRESSION_COMPATIBILITY_LABELS,
} from "../../../../shared/trade-preference-types";
import type {
  BroadExpressionType,
  ExpressionOption,
  ExpressionOptionsResult,
  ExpressionCompatibilityStatus,
} from "../../../../shared/trade-preference-types";

interface BroadExpressionSelectionStepProps {
  symbol: string;
  sessionId?: string;
  currentSelection?: BroadExpressionType | null;
  onSelected: (expressionType: BroadExpressionType) => void;
  onSkip?: () => void;
}

function compatibilityBadge(status: ExpressionCompatibilityStatus): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
  className: string;
} {
  switch (status) {
    case "AVAILABLE":
      return { label: "Available", variant: "default", className: "bg-green-600/10 text-green-700 border-green-600/20" };
    case "AVAILABLE_WITH_REQUIREMENTS":
      return { label: "Available with Requirements", variant: "secondary", className: "bg-amber-500/10 text-amber-700 border-amber-500/20" };
    case "NOT_ALIGNED_WITH_CURRENT_RESEARCH":
      return { label: "Not Aligned with Current Research", variant: "outline", className: "text-muted-foreground" };
    case "UNAVAILABLE":
      return { label: "Unavailable", variant: "outline", className: "text-muted-foreground opacity-60" };
  }
}

function ExpressionCard({
  option,
  onSelect,
  isSelected,
  disabled,
}: {
  option: ExpressionOption;
  onSelect: () => void;
  isSelected: boolean;
  disabled: boolean;
}) {
  const badge = compatibilityBadge(option.compatibilityStatus);
  const isUnavailable = option.compatibilityStatus === "UNAVAILABLE";

  return (
    <div
      className={`relative rounded-lg border p-4 transition-all ${
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : isUnavailable
          ? "border-border opacity-50 cursor-not-allowed"
          : "border-border hover:border-primary/50 cursor-pointer"
      }`}
      onClick={disabled || isUnavailable ? undefined : onSelect}
      onKeyDown={e => {
        if ((e.key === "Enter" || e.key === " ") && !disabled && !isUnavailable) {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={isUnavailable ? -1 : 0}
      role="button"
      aria-pressed={isSelected}
      aria-disabled={isUnavailable}
      aria-label={`${option.label} — ${badge.label}`}
      data-testid={`expression-card-${option.expressionType}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {option.preferredByUser && (
            <Star className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="Your preferred structure" />
          )}
          {isSelected && (
            <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
          )}
          <span className="font-medium text-sm truncate">{option.label}</span>
        </div>
        <Badge
          variant={badge.variant}
          className={`text-xs shrink-0 ${badge.className}`}
        >
          {badge.label}
        </Badge>
      </div>

      {/* Educational summary */}
      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
        {option.educationalSummary}
      </p>

      {/* Reasons */}
      {option.reasons.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-0.5 mb-2">
          {option.reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="text-primary/60 shrink-0 mt-0.5">·</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Requirements */}
      {option.requirements.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1 mb-2 space-y-0.5">
          {option.requirements.slice(0, 2).map((r, i) => (
            <div key={i} className="flex items-start gap-1">
              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}

      {/* CTA */}
      {!isUnavailable && (
        <Button
          size="sm"
          variant={isSelected ? "default" : "outline"}
          className="w-full mt-1 text-xs h-8"
          onClick={e => { e.stopPropagation(); if (!disabled) onSelect(); }}
          disabled={disabled}
          data-testid={`explore-btn-${option.expressionType}`}
          aria-label={`Explore ${option.label}`}
        >
          {isSelected ? "Selected" : `Explore ${option.label}`}
          {!isSelected && <ChevronRight className="h-3.5 w-3.5 ml-1" />}
        </Button>
      )}
    </div>
  );
}

export function BroadExpressionSelectionStep({
  symbol,
  sessionId,
  currentSelection,
  onSelected,
  onSkip,
}: BroadExpressionSelectionStepProps) {
  const qc = useQueryClient();
  const [localSelection, setLocalSelection] = useState<BroadExpressionType | null>(currentSelection ?? null);

  const queryKey = ["/api/trade-planning", symbol, "expression-options", sessionId ?? "no-session"];
  const { data, isLoading, error } = useQuery<ExpressionOptionsResult>({
    queryKey,
    queryFn: () => {
      const url = sessionId
        ? `/api/trade-planning/${symbol}/expression-options?sessionId=${sessionId}`
        : `/api/trade-planning/${symbol}/expression-options`;
      return apiRequest("GET", url).then(r => r.json());
    },
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
  });

  const selectionMutation = useMutation({
    mutationFn: (expressionType: BroadExpressionType) => {
      if (!sessionId) return Promise.resolve({ selection: { selectedExpressionType: expressionType, selectedBy: "USER" } });
      return apiRequest("POST", `/api/trade-planning/session/${sessionId}/expression-selection`, {
        selectedExpressionType: expressionType,
      }).then(r => r.json());
    },
    onSuccess: (_, expressionType) => {
      setLocalSelection(expressionType);
      if (sessionId) {
        qc.invalidateQueries({ queryKey: ["/api/trade-planning/session", sessionId, "expression-selection"] });
      }
      onSelected(expressionType);
    },
  });

  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Loading research structures…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="py-4 text-center text-sm text-destructive">
        <AlertCircle className="h-4 w-4 mx-auto mb-1" />
        Could not load research structure options.
      </div>
    );
  }

  // Partition into sections
  const preferred = data.options.filter(o => o.preferredByUser && o.compatibilityStatus !== "UNAVAILABLE");
  const otherAvailable = data.options.filter(
    o => !o.preferredByUser && (o.compatibilityStatus === "AVAILABLE" || o.compatibilityStatus === "AVAILABLE_WITH_REQUIREMENTS")
  );
  const notAligned = data.options.filter(o => o.compatibilityStatus === "NOT_ALIGNED_WITH_CURRENT_RESEARCH");
  const unavailable = data.options.filter(o => o.compatibilityStatus === "UNAVAILABLE");

  const allPreferred = preferred.length > 0;
  const showOtherSection = data.userPreferences?.showOtherCompatibleStructures !== false;

  return (
    <div className="space-y-6" data-testid="expression-selection-step">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold">How would you like to explore this opportunity?</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Select the type of research structure you want to explore for <strong>{symbol}</strong>.
          Your selection determines which specific strategies are analyzed.
        </p>
      </div>

      {/* Section A: Preferred */}
      {allPreferred && (
        <section aria-labelledby="preferred-section-heading">
          <h4 id="preferred-section-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
            <Star className="h-3 w-3 text-amber-500" />
            Your Preferred Research Structures
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {preferred.map(opt => (
              <ExpressionCard
                key={opt.expressionType}
                option={opt}
                isSelected={localSelection === opt.expressionType}
                disabled={selectionMutation.isPending}
                onSelect={() => selectionMutation.mutate(opt.expressionType)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Section B: Other compatible */}
      {showOtherSection && otherAvailable.length > 0 && (
        <section aria-labelledby="other-section-heading">
          <h4 id="other-section-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {allPreferred ? "Other Compatible Structures" : "Compatible Research Structures"}
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {otherAvailable.map(opt => (
              <ExpressionCard
                key={opt.expressionType}
                option={opt}
                isSelected={localSelection === opt.expressionType}
                disabled={selectionMutation.isPending}
                onSelect={() => selectionMutation.mutate(opt.expressionType)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Section C: Not aligned / Unavailable */}
      {(notAligned.length > 0 || unavailable.length > 0) && (
        <section aria-labelledby="unavail-section-heading">
          <h4 id="unavail-section-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Currently Unavailable / Not Aligned
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {[...notAligned, ...unavailable].map(opt => (
              <ExpressionCard
                key={opt.expressionType}
                option={opt}
                isSelected={localSelection === opt.expressionType}
                disabled={selectionMutation.isPending}
                onSelect={() => {}}
              />
            ))}
          </div>
        </section>
      )}

      {/* Compliance disclaimer */}
      <div className="rounded-md bg-muted/50 px-3 py-2.5 flex gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <p>{EXPRESSION_SELECTION_DISCLAIMER}</p>
      </div>

      {/* Skip / continue without selection */}
      {onSkip && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onSkip} className="text-xs text-muted-foreground">
            Continue without selecting a structure
          </Button>
        </div>
      )}
    </div>
  );
}
