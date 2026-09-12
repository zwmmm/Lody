import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function getSettingsPath(): string {
  const override = process.env.LODY_DATA_DIR?.trim()
  const dataDir = override ? path.resolve(override) : path.join(os.homedir(), '.lody')
  return path.join(dataDir, 'electron-settings.json')
}

export function readElectronSettings(): Record<string, unknown> {
  try {
    const settingsPath = getSettingsPath()
    if (!fs.existsSync(settingsPath)) {
      return {}
    }
    const raw = fs.readFileSync(settingsPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

export function writeElectronSettings(settings: Record<string, unknown>): void {
  try {
    const settingsPath = getSettingsPath()
    const dataDir = path.dirname(settingsPath)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  } catch {
    // best effort
  }
}

export function updateElectronSettings(
  updater: (prev: Record<string, unknown>) => Record<string, unknown>
): Record<string, unknown> {
  const current = readElectronSettings()
  const updated = updater(current)
  writeElectronSettings(updated)
  return updated
}
