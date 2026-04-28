"use client";

import { create } from "zustand";

type SentinelStore = {
  isZkShielded: boolean;
  allocationStrategy: number;
  setZkShielded: (value: boolean) => void;
  setAllocationStrategy: (value: number) => void;
};

function clampPercentage(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export const useSentinelStore = create<SentinelStore>((set) => ({
  isZkShielded: true,
  allocationStrategy: 70,
  setZkShielded: (value) => set({ isZkShielded: value }),
  setAllocationStrategy: (value) => set({ allocationStrategy: clampPercentage(value) })
}));
