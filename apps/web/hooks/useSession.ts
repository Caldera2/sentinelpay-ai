"use client";
import { useQuery } from "@tanstack/react-query";
import { ApiError, fetchApiJson } from "../lib/api";

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      try {
        return await fetchApiJson<{ walletAddress: string }>("/auth/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}
