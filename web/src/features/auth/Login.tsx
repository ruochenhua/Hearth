import { useState } from "react";
import { ArrowUpRight, LockKeyhole, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Brand from "@/components/Brand";
import ErrorNotice from "@/components/ErrorNotice";
import { api, errorText } from "@/lib/api";

type FormSubmitEvent = { preventDefault: () => void };

export default function Login({ name, onLogin }: { name: string; onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormSubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/login", { method: "POST", body: JSON.stringify({ password }) });
      onLogin();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">OUR FAMILY ARCHIVE</span>
          <h1>
            把日子留住，
            <br />
            慢慢回看。
          </h1>
          <p>
            那些一起走过的路、过过的生日，
            <br />
            还有平凡却闪闪发光的一天。
          </p>
        </div>
        <div className="login-caption">
          <LockKeyhole size={17} />
          回忆保存在家里的电脑上
        </div>
      </section>
      <section className="login-form">
        <span className="eyebrow">WELCOME HOME</span>
        <h2>{name}</h2>
        <p>输入相册密码，看看我们最近的故事。</p>
        <form onSubmit={submit}>
          <label htmlFor="password">相册密码</label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <ErrorNotice message={error} />
          <Button type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : <ArrowUpRight />}进入相册
          </Button>
        </form>
        <small>首次使用？密码保存在电脑项目目录的 .local-access.txt 中。</small>
      </section>
    </main>
  );
}
