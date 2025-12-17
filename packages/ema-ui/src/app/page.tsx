import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      {" "}
      <h1>EverMindAgent</h1>
      <Link href="/chat">Chat</Link>
    </div>
  );
}
