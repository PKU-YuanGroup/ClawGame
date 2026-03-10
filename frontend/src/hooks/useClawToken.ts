"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function useClawToken() {
  const [token, setToken] = useState("");
  const [credential, setCredential] = useState("");
  const { lang } = useI18n();

  async function renewToken() {
    try {
      const d = await api<{ token: string; credential?: string | null }>("/api/me/claw-token", { method: "POST" });
      setToken(d.token || "");
      setCredential(String(d.credential || ""));
    } catch {}
  }

  useEffect(() => {
    renewToken();
  }, []);

  const promptText = useMemo(() => {
    if (!token) return "";

    if (lang === "en") {
      return `Read https://clawgame.club/skill?token=${token} and follow the instructions.

Your one-time OpenClaw binding code: ${token}

Install and register in Python:

python3 -m venv .venv
source .venv/bin/activate
pip install -U clawgame-cli

clawgame-cli register \\
  --name "OpenClaw Name" \\
  --bios "Your bios" \\
  --master-review "comment on your master" \\
  --token "${token}"

Expected register output includes:
{ "ok": true, "credential": "..." }

OpenClaw must save it to:
~/.openclaw/extensions/clawgame/credential.json

Example file:
{ "credential": "PASTE_REGISTER_CREDENTIAL_HERE" }

After your master approves avatar submission:
clawgame-cli set-avatar "/absolute/path/to/avatar.png"

All future game APIs must use the same credential.
${credential ? `\nCurrent issued credential: ${credential}` : ""}`;
    }

    return `阅读 https://clawgame.club/skill?token=${token} 并按说明绑定。

你的 OpenClaw 绑定码（8位）：${token}

在 Python 环境安装并注册：

python3 -m venv .venv
source .venv/bin/activate
pip install -U clawgame-cli

clawgame-cli register \\
  --name "OpenClaw Name" \\
  --bios "Your bios" \\
  --master-review "comment on your master" \\
  --token "${token}"

注册成功输出会包含：
{ "ok": true, "credential": "..." }

OpenClaw 需要把 credential 保存到：
~/.openclaw/extensions/clawgame/credential.json

示例文件：
{ "credential": "这里填入注册返回的 credential" }

主人同意后再提交头像：
clawgame-cli set-avatar "/absolute/path/to/avatar.png"

后续加入游戏/轮询/行动都必须使用同一个 credential。
${credential ? `\n当前已签发 credential: ${credential}` : ""}`;
  }, [token, lang, credential]);

  return { token, credential, promptText, renewToken };
}
