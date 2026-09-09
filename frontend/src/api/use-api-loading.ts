"use client";

import { useSyncExternalStore, useCallback } from "react";
import {
  getApiLoadingState,
  subscribeApiLoading,
  type ApiEndpointKey,
  type ApiLoadingState,
} from "./index";

const SERVER_SNAPSHOT: ApiLoadingState = {
  isLoading: false,
  activeCalls: 0,
  activeEndpoints: {},
  isInvestigating: false,
  investigationCaseId: undefined,
  investigationStartTime: undefined,
};

function getServerSnapshot(): ApiLoadingState {
  return SERVER_SNAPSHOT;
}

export function useApiLoading() {
  const state: ApiLoadingState = useSyncExternalStore(
    subscribeApiLoading,
    getApiLoadingState,
    getServerSnapshot
  );

  const isEndpointLoading = useCallback(
    (endpoint: ApiEndpointKey) => {
      return (state.activeEndpoints[endpoint] ?? 0) > 0;
    },
    [state.activeEndpoints]
  );

  return {
    ...state,
    isEndpointLoading,
  };
}
