"use client";

import * as React from "react";
import {
  WifiOff,
  SearchX,
  AlertTriangle,
  KeyRound,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Calendar,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiConfig, setApiConfig, ApiClientError } from "@/api";

export interface BackendUnreachableErrorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  endpointUrl?: string;
  onRetry?: () => void;
}

export function BackendUnreachableError({
  endpointUrl,
  onRetry,
  className,
  ...props
}: BackendUnreachableErrorProps) {
  const url = endpointUrl || getApiConfig().baseUrl;

  return (
    <div
      className={cn(
        "w-full max-w-lg mx-auto rounded-[3px] border border-neutral-300 bg-background p-6 shadow-xs select-none text-center",
        className
      )}
      {...props}
    >
      <div className="w-12 h-12 rounded-full bg-neutral-200 text-neutral-800 flex items-center justify-center mx-auto mb-4">
        <WifiOff className="w-6 h-6" />
      </div>
      <h3 className="font-h6 text-neutral-1000 mb-2 font-bold">
        Backend Unreachable
      </h3>
      <p className="font-b2 text-neutral-700 mb-4 leading-relaxed">
        Could not establish a connection to the AgCyRAG backend. Make sure the API service is running locally.
      </p>
      <div className="rounded-[3px] bg-neutral-100 border border-neutral-200 p-3 mb-6 font-mono font-b3 text-neutral-900 break-all text-left">
        <span className="text-neutral-600 block mb-1 font-semibold">Target Endpoint:</span>
        {url}
      </div>
      <div className="flex justify-center gap-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 rounded-[3px] bg-primary-800 hover:bg-primary-700 text-neutral-100 font-b3 py-2 px-3.5 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Retry Connection
          </button>
        )}
      </div>
    </div>
  );
}

export interface CaseNotFoundErrorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  caseId?: string;
  lookbackHours?: number;
  errorDetail?: string;
  onRetryWithLookback?: (hours: number) => void;
  onBackToCases?: () => void;
}

export function CaseNotFoundError({
  caseId,
  lookbackHours,
  errorDetail,
  onRetryWithLookback,
  onBackToCases,
  className,
  ...props
}: CaseNotFoundErrorProps) {
  const hintMatch = errorDetail?.match(/lookback_hours=([0-9.]+)/);
  const currentLookback = hintMatch ? hintMatch[1] : (lookbackHours ?? 24);

  return (
    <div
      className={cn(
        "w-full max-w-xl mx-auto rounded-[3px] border border-yellow-300 bg-yellow-100/35 p-6 shadow-xs select-none",
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-4 mb-4">
        <div className="w-10 h-10 rounded-full bg-yellow-200 text-yellow-500 flex items-center justify-center shrink-0 mt-0.5">
          <SearchX className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-h6 text-yellow-500 font-bold">
            Case Not Found in Lookback Window
          </h3>
          <p className="font-b3 text-neutral-800 mt-1 leading-normal">
            Cases are dynamically clustered from alerts in Neo4j. Historical replays (like AIT-ADS) fall outside the default lookback window.
          </p>
        </div>
      </div>

      <div className="rounded-[3px] bg-background border border-yellow-200 p-4 mb-5 space-y-2.5">
        {caseId && (
          <div className="font-b3 text-neutral-800">
            <span className="font-semibold text-neutral-700 mr-2">Case ID:</span>
            <code className="font-mono bg-neutral-100 border border-neutral-200 px-1.5 py-0.5 rounded-[3px] text-black-600 font-semibold">
              {caseId}
            </code>
          </div>
        )}
        <div className="font-b3 text-neutral-800">
          <span className="font-semibold text-neutral-700 mr-2">Current Lookback:</span>
          <span className="font-mono font-semibold text-black-600">{currentLookback} hours</span>
        </div>
        {errorDetail && (
          <div className="pt-2.5 border-t border-yellow-200">
            <span className="font-b4 font-bold text-yellow-500 uppercase tracking-wider block mb-1.5">
              Backend Lookback Hint
            </span>
            <p className="font-b4 text-neutral-900 leading-relaxed font-mono bg-yellow-100/50 border border-yellow-200 p-2.5 rounded-[3px]">
              {errorDetail}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-2">
        {onBackToCases && (
          <button
            type="button"
            onClick={onBackToCases}
            className="inline-flex items-center gap-1.5 font-b2 text-neutral-700 hover:text-neutral-1000 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Cases
          </button>
        )}
        {onRetryWithLookback && (
          <button
            type="button"
            onClick={() => onRetryWithLookback(336)}
            className="inline-flex items-center justify-center gap-2 rounded-[3px] bg-primary-800 hover:bg-primary-700 text-neutral-100 font-b3 py-2 px-3.5 transition-colors cursor-pointer"
          >
            <Calendar className="w-4 h-4" />
            Expand to 14 Days (336h)
          </button>
        )}
      </div>
    </div>
  );
}

export interface PipelineFailureErrorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  caseId?: string;
  error?: string | null;
  onRetry?: () => void;
}

export function PipelineFailureError({
  caseId,
  error,
  onRetry,
  className,
  ...props
}: PipelineFailureErrorProps) {
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div
      className={cn(
        "w-full max-w-xl mx-auto rounded-[3px] border-2 border-red-300 bg-red-100/25 p-6 shadow-xs select-none",
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-4 mb-4">
        <div className="w-10 h-10 rounded-full bg-red-200 text-red-500 flex items-center justify-center shrink-0 mt-0.5">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-b5 uppercase px-2 py-0.5 rounded-[3px] font-bold bg-red-300 text-neutral-100 tracking-wider">
              Pipeline Failure
            </span>
            <span className="font-b4 text-red-500 font-bold">
              Not an Empty Result
            </span>
          </div>
          <h3 className="font-h6 text-red-500 font-bold">
            Investigation Multi-Agent Execution Failed
          </h3>
          <p className="font-b3 text-neutral-800 mt-1 leading-normal">
            The reasoning agents encountered a fault during retrieval, synthesis, or graph querying. This does not indicate that no threat activity was found.
          </p>
        </div>
      </div>

      {caseId && (
        <div className="font-b3 text-neutral-800 mb-3 bg-background rounded-[3px] p-2.5 border border-red-200">
          <span className="font-semibold text-neutral-700 mr-2">Target Case:</span>
          <code className="font-mono text-black-600 font-bold">{caseId}</code>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowDetails((prev) => !prev)}
            className="flex items-center gap-1.5 font-b3 font-bold text-red-400 hover:text-red-500 transition-colors cursor-pointer"
          >
            {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showDetails ? "Hide Pipeline Trace" : "View Pipeline Trace"}
          </button>
          {showDetails && (
            <pre className="mt-2 p-3 rounded-[3px] bg-black-600 text-red-100 border border-red-300 font-mono font-b4 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {error}
            </pre>
          )}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 rounded-[3px] bg-red-400 hover:bg-red-500 text-neutral-100 font-b3 py-2 px-3.5 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Retry Pipeline Run
          </button>
        )}
      </div>
    </div>
  );
}

export interface ApiKeyAuthErrorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  onSuccess?: () => void;
  onRetry?: () => void;
}

export function ApiKeyAuthError({
  onSuccess,
  onRetry,
  className,
  ...props
}: ApiKeyAuthErrorProps) {
  const [apiKeyInput, setApiKeyInput] = React.useState(
    getApiConfig().apiKey || ""
  );
  const [saved, setSaved] = React.useState(false);

  const handleSaveAndRetry = (e: React.FormEvent) => {
    e.preventDefault();
    setApiConfig({ apiKey: apiKeyInput.trim() });
    setSaved(true);
    if (onSuccess) onSuccess();
    if (onRetry) onRetry();
  };

  return (
    <div
      className={cn(
        "w-full max-w-md mx-auto rounded-[3px] border border-neutral-300 bg-background p-6 shadow-xs select-none",
        className
      )}
      {...props}
    >
      <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-800 flex items-center justify-center mx-auto mb-4">
        <KeyRound className="w-6 h-6" />
      </div>
      <h3 className="font-h6 text-neutral-1000 text-center mb-1 font-bold">
        API Key Authentication Required
      </h3>
      <p className="font-b3 text-neutral-700 text-center mb-5 leading-normal">
        The backend requires an <code className="bg-neutral-100 border border-neutral-200 px-1 py-0.5 rounded-[3px] font-mono font-semibold text-black-600">X-API-Key</code> matching INVESTIGATION_API_KEY.
      </p>

      <form onSubmit={handleSaveAndRetry} className="space-y-4">
        <div>
          <label className="block font-b3 font-semibold text-neutral-900 mb-1.5">
            X-API-Key
          </label>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="Enter API Key"
            className="w-full px-3 py-2 rounded-[3px] border border-neutral-300 font-mono font-b3 bg-neutral-100 text-black-600 focus:outline-hidden focus:border-primary-600 focus:bg-background transition-colors"
          />
        </div>

        {saved && (
          <p className="font-b3 text-green-500 font-semibold text-center">
            Key saved to client configuration!
          </p>
        )}

        <button
          type="submit"
          className="w-full inline-flex items-center justify-center gap-2 rounded-[3px] bg-primary-800 hover:bg-primary-700 text-neutral-100 font-b3 py-2 px-3.5 transition-colors cursor-pointer"
        >
          <ShieldAlert className="w-4 h-4" />
          Save Key & Retry
        </button>
      </form>
    </div>
  );
}

export type ErrorCategory =
  | "401"
  | "404"
  | "500"
  | "unreachable"
  | "generic";

export function getErrorCategory(error: unknown): ErrorCategory {
  if (!error) return "generic";

  if (error instanceof ApiClientError) {
    if (error.status === 401) return "401";
    if (error.status === 404) return "404";
    if (error.status >= 500) return "500";
  }

  const msg = error instanceof Error ? error.message : String(error);

  if (/Failed to fetch|NetworkError|ECONNREFUSED|Load failed/i.test(msg)) {
    return "unreachable";
  }
  if (/\b401\b|API-Key|Unauthorized/i.test(msg)) {
    return "401";
  }
  if (/\b404\b|not found|lookback_hours/i.test(msg)) {
    return "404";
  }
  if (/\b500\b|pipeline failed|RecursionLimit|timeout/i.test(msg)) {
    return "500";
  }

  return "generic";
}

export interface ApiErrorViewProps
  extends React.HTMLAttributes<HTMLDivElement> {
  error: unknown;
  caseId?: string;
  onRetry?: () => void;
  onBackToCases?: () => void;
  onRetryWithLookback?: (hours: number) => void;
}

export function ApiErrorView({
  error,
  caseId,
  onRetry,
  onBackToCases,
  onRetryWithLookback,
  className,
  ...props
}: ApiErrorViewProps) {
  const category = getErrorCategory(error);

  const errorDetail =
    error instanceof ApiClientError
      ? error.detail
      : error instanceof Error
      ? error.message
      : String(error);

  if (category === "401") {
    return (
      <ApiKeyAuthError
        onSuccess={onRetry}
        onRetry={onRetry}
        className={className}
        {...props}
      />
    );
  }

  if (category === "404") {
    return (
      <CaseNotFoundError
        caseId={caseId}
        errorDetail={errorDetail}
        onRetryWithLookback={onRetryWithLookback}
        onBackToCases={onBackToCases}
        className={className}
        {...props}
      />
    );
  }

  if (category === "500") {
    return (
      <PipelineFailureError
        caseId={caseId}
        error={errorDetail}
        onRetry={onRetry}
        className={className}
        {...props}
      />
    );
  }

  if (category === "unreachable") {
    return (
      <BackendUnreachableError
        onRetry={onRetry}
        className={className}
        {...props}
      />
    );
  }

  return (
    <div
      className={cn(
        "w-full max-w-lg mx-auto rounded-[3px] border border-neutral-300 bg-background p-6 shadow-xs select-none text-center",
        className
      )}
      {...props}
    >
      <div className="w-12 h-12 rounded-full bg-neutral-200 text-neutral-800 flex items-center justify-center mx-auto mb-4">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <h3 className="font-h6 text-neutral-1000 mb-2 font-bold">
        An Unexpected Error Occurred
      </h3>
      <p className="font-b2 text-neutral-700 mb-5 leading-relaxed wrap-break-word">
        {errorDetail}
      </p>
      {onRetry && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 rounded-[3px] bg-primary-800 hover:bg-primary-700 text-neutral-100 font-b3 py-2 px-3.5 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}

export interface ScreenErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

export interface ScreenErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ScreenErrorBoundary extends React.Component<
  ScreenErrorBoundaryProps,
  ScreenErrorBoundaryState
> {
  constructor(props: ScreenErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ScreenErrorBoundaryState {
    return { hasError: true, error };
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div className="flex-1 flex items-center justify-center p-6 min-h-90">
          <ApiErrorView error={this.state.error} onRetry={this.reset} />
        </div>
      );
    }
    return this.props.children;
  }
}
