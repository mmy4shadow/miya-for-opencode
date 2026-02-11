import { spawnSync } from "node:child_process"
import path from "node:path"
import { mkdirSync } from "node:fs"
import { Global } from "@/global"

const SERVICE_NAME = "opencode-miya"
const WINDOWS_SECRET_FILE = path.join(Global.Path.data, "miya", "secrets.dpapi.json")

type SecretFile = Record<string, string>

function runCommand(command: string, args: string[], input?: string) {
  const output = spawnSync(command, args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  })
  if (output.status !== 0) {
    const detail = (output.stderr || output.stdout || "").trim() || `exit code ${output.status ?? 1}`
    throw new Error(detail)
  }
  return (output.stdout || "").trim()
}

function escapePowerShellString(value: string) {
  return value.replace(/'/g, "''")
}

async function readWindowsSecretFile(): Promise<SecretFile> {
  const raw = await Bun.file(WINDOWS_SECRET_FILE).text().catch(() => "")
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.entries(parsed).reduce((acc, [k, v]) => {
      if (typeof v === "string") acc[k] = v
      return acc
    }, {} as SecretFile)
  } catch {
    return {}
  }
}

async function writeWindowsSecretFile(content: SecretFile) {
  mkdirSync(path.dirname(WINDOWS_SECRET_FILE), { recursive: true })
  await Bun.write(WINDOWS_SECRET_FILE, `${JSON.stringify(content, null, 2)}\n`)
}

function dpapiEncrypt(value: string) {
  const escaped = escapePowerShellString(value)
  return runCommand("powershell", [
    "-NoProfile",
    "-Command",
    `$sec=ConvertTo-SecureString '${escaped}' -AsPlainText -Force; ConvertFrom-SecureString $sec`,
  ])
}

function dpapiDecrypt(value: string) {
  const escaped = escapePowerShellString(value)
  return runCommand("powershell", [
    "-NoProfile",
    "-Command",
    `$sec=ConvertTo-SecureString '${escaped}'; $b=[System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec); [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($b)`,
  ])
}

async function setWindowsSecret(key: string, value: string) {
  const current = await readWindowsSecretFile()
  current[key] = dpapiEncrypt(value)
  await writeWindowsSecretFile(current)
}

async function getWindowsSecret(key: string) {
  const current = await readWindowsSecretFile()
  const encrypted = current[key]
  if (!encrypted) return undefined
  try {
    return dpapiDecrypt(encrypted)
  } catch {
    return undefined
  }
}

async function removeWindowsSecret(key: string) {
  const current = await readWindowsSecretFile()
  if (!(key in current)) return false
  delete current[key]
  await writeWindowsSecretFile(current)
  return true
}

function setMacSecret(key: string, value: string) {
  runCommand("security", [
    "add-generic-password",
    "-a",
    key,
    "-s",
    SERVICE_NAME,
    "-w",
    value,
    "-U",
  ])
}

function getMacSecret(key: string) {
  try {
    return runCommand("security", [
      "find-generic-password",
      "-a",
      key,
      "-s",
      SERVICE_NAME,
      "-w",
    ])
  } catch {
    return undefined
  }
}

function removeMacSecret(key: string) {
  try {
    runCommand("security", [
      "delete-generic-password",
      "-a",
      key,
      "-s",
      SERVICE_NAME,
    ])
    return true
  } catch {
    return false
  }
}

function setLinuxSecret(key: string, value: string) {
  runCommand("secret-tool", ["store", "--label", `${SERVICE_NAME}:${key}`, "service", SERVICE_NAME, "account", key], value)
}

function getLinuxSecret(key: string) {
  try {
    return runCommand("secret-tool", ["lookup", "service", SERVICE_NAME, "account", key])
  } catch {
    return undefined
  }
}

function removeLinuxSecret(key: string) {
  try {
    runCommand("secret-tool", ["clear", "service", SERVICE_NAME, "account", key])
    return true
  } catch {
    return false
  }
}

export namespace SecretStore {
  function platform() {
    return process.platform
  }

  export function backend() {
    const p = platform()
    if (p === "darwin") return "macos-keychain"
    if (p === "win32") return "windows-dpapi"
    return "linux-secret-service"
  }

  export async function set(key: string, value: string) {
    const p = platform()
    if (p === "darwin") {
      setMacSecret(key, value)
      return
    }
    if (p === "win32") {
      await setWindowsSecret(key, value)
      return
    }
    try {
      setLinuxSecret(key, value)
    } catch (error) {
      throw new Error(
        `failed to store secret in Secret Service (install 'secret-tool'): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  export async function get(key: string) {
    const p = platform()
    if (p === "darwin") return getMacSecret(key)
    if (p === "win32") return getWindowsSecret(key)
    try {
      return getLinuxSecret(key)
    } catch {
      return undefined
    }
  }

  export async function remove(key: string) {
    const p = platform()
    if (p === "darwin") return removeMacSecret(key)
    if (p === "win32") return removeWindowsSecret(key)
    try {
      return removeLinuxSecret(key)
    } catch {
      return false
    }
  }

  export async function has(key: string) {
    const value = await get(key)
    return typeof value === "string" && value.length > 0
  }
}
