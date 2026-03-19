"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  useEffect(() => {
    void fetch("/api/v1/login");
  }, []);

  return (
    <div className={styles.page}>
      <h1>EverMemoryArchive</h1>
      <Link href="/chat">Chat</Link>
      <br />
      <Link href="/train" prefetch={false}>
        Train
      </Link>
    </div>
  );
}
