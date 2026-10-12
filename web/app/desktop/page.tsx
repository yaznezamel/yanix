import type { Metadata } from "next";
import { DesktopLab } from "@/components/lab/DesktopLab";

export const metadata: Metadata = {
  title: "Desktop lab · Yanix",
  description:
    "Use a simulated Linux desktop and watch every click, search and file read travel through user space, the kernel, the hardware and the network.",
};

export default function DesktopPage() {
  return <DesktopLab />;
}
