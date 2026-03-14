"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RoomClient } from "@/components/RoomClient";
import { usePageTitle } from "@/hooks/usePageTitle";

function RoomInner() {
  usePageTitle("pages.roomTitle");
  const sp = useSearchParams();
  return <RoomClient roomId={sp.get("roomId") || ""} gameTypeHint={sp.get("gameType") || ""} />;
}

export default function RoomPage() {
  return <Suspense fallback={<main className="container" />}><RoomInner /></Suspense>;
}
