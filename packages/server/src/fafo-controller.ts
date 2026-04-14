/**
 * FAFO Controller — execution engine for multi-path swarm generations.
 *
 * Handles: worktree lifecycle, vite-per-port, per-path Claude dispatch,
 * fitness evaluation (screenshot + crop + diff), survivor selection.
 */

import { eq } from 'drizzle-orm';
import { ulid } from 'ulidx';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { db, schema } from './db/index.js';
import { startWiggumRun } from './wiggum-controller.js';
import { dispatchAgentSession } from './dispatch.js';

interface FAFOPath {
  id: string;
  name: string;
  prompt: string;
  files: string | null;
  focusLines: string | null;
  cropRegion: string | null;
  fitnessMetric: string | null;
  fitnessCommand: string | null;
  worktreePort: number | null;
  worktreeBranch: string | null;
  worktreePath: string | null;
  status: string;
  order: number;
}

// Active generation trackers
const activeGenerations = new Map<string, { abort: AbortController }>();

/**
 * Seed wiki directory from LESSONS.md or copy from previous generation.
 */
function seedWiki(runRoot: string, prevRunRoot: string | null): void {
  const wikiDir = `${runRoot}/wiki`;
  mkdirSync(wikiDir, { recursive: true });

  // If a previous generation wiki exists, copy it forward
  if (prevRunRoot) {
    const prevWiki = `${prevRunRoot}/wiki`;
    if (existsSync(prevWiki)) {
      try {
        cpSync(prevWiki, wikiDir, { recursive: true });
        console.log(`[fafo] Copied wiki from ${prevWiki} to ${wikiDir}`);
        return;
      } catch (err: any) {
        console.warn(`[fafo] Failed to copy previous wiki:`, err.message);
      }
    }
  }

  // Initial generation: seed from LESSONS.md
  const lessonsPath = '/tmp/fafo-runs/LESSONS.md';
  let lessons = '';
  if (existsSync(lessonsPath)) {
    try { lessons = readFileSync(lessonsPath, 'utf-8'); } catch { /* ignore */ }
  }

  writeFileSync(`${wikiDir}/what-works.md`, `# What Works\nTechniques that improved the diff score.\n\n${
    lessons.includes('What\'s Done') ? lessons.split('## Exact Ground Truth')[0] : '(no prior data)'
  }\n`);

  writeFileSync(`${wikiDir}/what-fails.md`, `# What Fails\nTechniques that made things worse.\n\n(no prior data)\n`);

  writeFileSync(`${wikiDir}/open-questions.md`, `# Open Questions\nThings we haven't tried yet.\n\n(no prior data)\n`);

  writeFileSync(`${wikiDir}/approach-log.md`, `# Approach Log\nAppend-only log of all approaches tried across generations. DO NOT repeat these.\n\n`);

  writeFileSync(`${wikiDir}/task-assignments.md`, `# Task Assignments\nDirected sub-problems for workers. Updated by the aggregator between generations.\n\n(initial generation — no directed tasks yet, explore freely)\n`);

  writeFileSync(`${wikiDir}/task-status.md`, `# Task Status\nTracks which sub-problems are solved vs open.\n\n`);

  writeFileSync(`${wikiDir}/coordinates.md`, `# Coordinates\nExact pixel/SVG coordinates of all elements.\n\n${
    lessons.includes('## Coordinates') ? lessons.slice(lessons.indexOf('## Coordinates')) .split('\n## Workflow')[0] : '(no prior data)'
  }\n`);

  writeFileSync(`${wikiDir}/style-params.md`, `# Style Parameters\nCurrent style values and what the target expects.\n\n${
    lessons.includes('## Exact Ground Truth') ? lessons.slice(lessons.indexOf('## Exact Ground Truth')).split('\n## API Field')[0] : '(no prior data)'
  }\n`);

  console.log(`[fafo] Seeded wiki at ${wikiDir}`);
}

/**
 * Extract specific lines from a file.
 */
function extractLines(filePath: string, lineSpec: string): string {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    // Parse spec like "100-200" or "100-200,300-350"
    const result: string[] = [];
    for (const range of lineSpec.split(',')) {
      const parts = range.trim().split('-').map(Number);
      const start = Math.max(1, parts[0]) - 1;
      const end = parts.length > 1 ? Math.min(lines.length, parts[1]) : start + 1;
      for (let i = start; i < end; i++) {
        result.push(`${i + 1}: ${lines[i]}`);
      }
    }
    return result.join('\n');
  } catch {
    return '(could not extract lines)';
  }
}

export function getActiveGenerationIds(): string[] {
  return [...activeGenerations.keys()];
}

/**
 * Start a new FAFO generation for a swarm.
 * For multi-path: creates worktrees, starts vite, dispatches Claude per path.
 * For single-mode: creates N wiggum runs with varied knobs.
 */
export async function startFAFOGeneration(
  swarmId: string,
  opts: {
    keepCount?: number;
    lessonsLearned?: string;
    knobs?: Record<string, any>;
    fanOut?: number;
  } = {},
): Promise<{
  swarm: any;
  generation: number;
  survivors: string[];
  dropped: string[];
  newRuns: any[];
  worktrees: { path: string; port: number; branch: string }[];
}> {
  const swarm = db.select().from(schema.wiggumSwarms)
    .where(eq(schema.wiggumSwarms.id, swarmId)).get();
  if (!swarm) throw new Error(`Swarm ${swarmId} not found`);

  const paths = db.select().from(schema.wiggumSwarmPaths)
    .where(eq(schema.wiggumSwarmPaths.swarmId, swarmId))
    .all()
    .sort((a, b) => a.order - b.order);

  const currentGen = swarm.generationCount;
  const now = new Date().toISOString();

  // ── Score & select survivors from current generation ──
  const currentRuns = db.select().from(schema.wiggumRuns)
    .where(eq(schema.wiggumRuns.swarmId, swarmId))
    .all()
    .filter(r => r.generation === currentGen);

  const scoredRuns = currentRuns
    .filter(r => r.fitnessScore != null)
    .sort((a, b) => (a.fitnessScore ?? Infinity) - (b.fitnessScore ?? Infinity));

  const keepCount = opts.keepCount ?? Math.max(1, Math.ceil(scoredRuns.length / 2));
  const survivors = scoredRuns.slice(0, keepCount);
  const dropped = scoredRuns.slice(keepCount);

  for (const r of survivors) {
    db.update(schema.wiggumRuns)
      .set({ survived: true, updatedAt: now })
      .where(eq(schema.wiggumRuns.id, r.id)).run();
  }
  for (const r of dropped) {
    db.update(schema.wiggumRuns)
      .set({ survived: false, updatedAt: now })
      .where(eq(schema.wiggumRuns.id, r.id)).run();
  }

  // ── Append knowledge ──
  if (opts.lessonsLearned) {
    const updated = (swarm.knowledgeContent || '') + `\n\n## Generation ${currentGen}\n\n` + opts.lessonsLearned;
    db.update(schema.wiggumSwarms)
      .set({ knowledgeContent: updated, updatedAt: now })
      .where(eq(schema.wiggumSwarms.id, swarmId)).run();
  }

  // ── Bump generation ──
  const nextGen = currentGen + 1;
  db.update(schema.wiggumSwarms)
    .set({ generationCount: nextGen, status: 'running', updatedAt: now })
    .where(eq(schema.wiggumSwarms.id, swarmId)).run();

  // ── Resolve project dir ──
  const isolation = swarm.isolation ? JSON.parse(swarm.isolation) : {};
  const repoDir = isolation.repoDir || process.cwd();
  const baseBranch = isolation.baseBranch || 'HEAD';
  const basePort = isolation.basePort ?? 5200;

  // ── Create run dir ──
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runRoot = `/tmp/fafo-runs/swarm-${swarmId.slice(-8)}-gen${nextGen}-${ts}`;
  mkdirSync(runRoot, { recursive: true });

  // Copy target artifact if specified
  if (swarm.targetArtifact && existsSync(swarm.targetArtifact)) {
    try {
      execSync(`cp "${swarm.targetArtifact}" "${runRoot}/target.png"`, { stdio: 'pipe' });
    } catch { /* ignore */ }
  }

  // Write multi-metric fitness tool (SSIM + edge IoU + histogram + pixel diff)
  writeFileSync(`${runRoot}/fitness.py`, `#!/usr/bin/env python3
"""Multi-metric fitness scoring: SSIM, edge IoU, color histogram, pixel diff.
Usage: python3 fitness.py target.png candidate.png [--crop x,y,w,h]
Output: JSON with composite score (lower=better) and sub-scores.
"""
import sys, json, argparse
import numpy as np
import cv2
from skimage.metrics import structural_similarity as ssim

parser = argparse.ArgumentParser()
parser.add_argument('target')
parser.add_argument('candidate')
parser.add_argument('--crop', type=str, default=None, help='x,y,w,h crop region')
args = parser.parse_args()

a = cv2.imread(args.target)
b = cv2.imread(args.candidate)
if a is None: sys.exit(f"Cannot read {args.target}")
if b is None: sys.exit(f"Cannot read {args.candidate}")

# Resize candidate to match target if different
if a.shape[:2] != b.shape[:2]:
    b = cv2.resize(b, (a.shape[1], a.shape[0]))

# Optional crop
if args.crop:
    x, y, w, h = [int(v) for v in args.crop.split(',')]
    a = a[y:y+h, x:x+w]
    b = b[y:y+h, x:x+w]

# 1. SSIM (structural similarity) — tolerant of small positional shifts
gray_a = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
gray_b = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
win_size = min(7, min(gray_a.shape[:2]) | 1)  # must be odd, <= image dims
if win_size < 3: win_size = 3
ssim_score = ssim(gray_a, gray_b, win_size=win_size)

# 2. Edge IoU — structural element presence via Canny with dilation for fuzzy match
edges_a = cv2.Canny(gray_a, 30, 100)
edges_b = cv2.Canny(gray_b, 30, 100)
# Dilate edges by 3px to tolerate small positional shifts
kernel = np.ones((3, 3), np.uint8)
dilated_a = cv2.dilate(edges_a, kernel, iterations=2)
dilated_b = cv2.dilate(edges_b, kernel, iterations=2)
# Fuzzy IoU: edge pixel in A matches if within 3px of edge in B
match_a_in_b = np.logical_and(edges_a > 0, dilated_b > 0).sum()
match_b_in_a = np.logical_and(edges_b > 0, dilated_a > 0).sum()
total_a = max((edges_a > 0).sum(), 1)
total_b = max((edges_b > 0).sum(), 1)
edge_iou = float((match_a_in_b / total_a + match_b_in_a / total_b) / 2)

# 3. Color histogram correlation
hist_scores = []
for ch in range(3):
    ha = cv2.calcHist([a], [ch], None, [64], [0, 256])
    hb = cv2.calcHist([b], [ch], None, [64], [0, 256])
    cv2.normalize(ha, ha)
    cv2.normalize(hb, hb)
    hist_scores.append(cv2.compareHist(ha, hb, cv2.HISTCMP_CORREL))
hist_corr = float(np.mean(hist_scores))

# 4. Pixel diff mean (backward compat)
diff = cv2.absdiff(a, b)
pixel_mean = float(diff.mean())

# Composite: lower = better
composite = 0.5 * (1 - ssim_score) + 0.3 * (1 - edge_iou) + 0.2 * (1 - max(0, hist_corr))

result = {
    "composite": round(composite, 4),
    "ssim": round(ssim_score, 4),
    "edge_iou": round(edge_iou, 4),
    "hist_corr": round(hist_corr, 4),
    "pixel_mean": round(pixel_mean, 3),
}
print(json.dumps(result))
`, { mode: 0o755 });

  // Also write legacy diff.py for backward compat
  if (!existsSync(`${runRoot}/diff.py`)) {
    writeFileSync(`${runRoot}/diff.py`, `#!/usr/bin/env python3
import sys, json
from PIL import Image, ImageChops
a = Image.open(sys.argv[1]).convert("RGB")
b = Image.open(sys.argv[2]).convert("RGB")
if a.size != b.size: b = b.resize(a.size)
d = ImageChops.difference(a, b)
px = list(d.getdata())
mean = sum(sum(p) for p in px) / (len(px) * 3)
print(json.dumps({"mean": round(mean, 3), "bbox": list(d.getbbox() or [])}))
`, { mode: 0o755 });
  }

  // Find previous generation's run root for wiki copying
  let prevRunRoot: string | null = null;
  if (currentGen > 0) {
    try {
      const parentDir = '/tmp/fafo-runs';
      const prefix = `swarm-${swarmId.slice(-8)}-gen${currentGen}-`;
      const entries = execSync(`ls -d ${parentDir}/${prefix}* 2>/dev/null || true`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
      if (entries.length > 0) {
        prevRunRoot = entries[entries.length - 1]; // most recent
      }
    } catch { /* ignore */ }
  }

  // Seed wiki
  seedWiki(runRoot, prevRunRoot);

  // Write swarm metadata
  writeFileSync(`${runRoot}/swarm.json`, JSON.stringify({
    swarmId, name: swarm.name, generation: nextGen,
    mode: swarm.mode, createdAt: now, target: 'target.png',
  }, null, 2));

  // Write knowledge file
  const knowledgeContent = db.select().from(schema.wiggumSwarms)
    .where(eq(schema.wiggumSwarms.id, swarmId)).get()?.knowledgeContent || '';
  if (knowledgeContent) {
    writeFileSync(`${runRoot}/KNOWLEDGE.md`, knowledgeContent);
  }

  const newRuns: any[] = [];
  const worktrees: { path: string; port: number; branch: string }[] = [];

  if (swarm.mode === 'multi-path' && paths.length > 0) {
    // ── Multi-path: one worktree + worker per path ──
    for (const path of paths) {
      const port = path.worktreePort || (basePort + path.order);
      const branch = path.worktreeBranch || `fafo-${swarmId.slice(-8)}-${path.name}`;
      const childDir = `${runRoot}/child-${path.name}`;
      const workDir = `${childDir}/work`;
      mkdirSync(childDir, { recursive: true });

      // Create worktree
      try {
        execSync(`cd "${repoDir}" && git worktree add "${workDir}" -b "${branch}-g${nextGen}" ${baseBranch} 2>&1 || git worktree add "${workDir}" ${baseBranch} --detach 2>&1`, {
          stdio: 'pipe', timeout: 30_000,
        });
      } catch (err: any) {
        console.error(`[fafo] Failed to create worktree for ${path.name}:`, err.message);
        writeFileSync(`${childDir}/error.txt`, err.message);
        continue;
      }

      // Symlink node_modules
      const repoNodeModules = resolve(repoDir, 'node_modules');
      const workNodeModules = resolve(workDir, 'node_modules');
      if (existsSync(repoNodeModules) && !existsSync(workNodeModules)) {
        try { symlinkSync(repoNodeModules, workNodeModules); } catch { /* ignore */ }
      }

      // Update path record with worktree path
      db.update(schema.wiggumSwarmPaths)
        .set({ worktreePath: workDir, worktreePort: port, worktreeBranch: `${branch}-g${nextGen}`, status: 'running', updatedAt: now })
        .where(eq(schema.wiggumSwarmPaths.id, path.id)).run();

      // Start vite on the assigned port
      try {
        const viteProc = spawn('./node_modules/.bin/vite', ['--port', String(port), '--host', '0.0.0.0'], {
          cwd: workDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
          env: { ...process.env, VITE_PORT: String(port) },
        });
        viteProc.unref();
        writeFileSync(`${childDir}/vite.pid`, String(viteProc.pid));
        console.log(`[fafo] Started vite for ${path.name} on port ${port} (pid=${viteProc.pid})`);
      } catch (err: any) {
        console.warn(`[fafo] Failed to start vite for ${path.name}:`, err.message);
      }

      // Write snap.sh for this child
      writeFileSync(`${childDir}/snap.sh`, `#!/usr/bin/env bash
set -e
OUT="$1"
URL="\${2:-http://localhost:${port}/#BMS%20electronics/DB10005_USBSerial.SchDoc?focus=USART1}"
TMP=$(mktemp --suffix=.png)
node /tmp/fafo-runs/snap-port.mjs "$TMP" "$URL"
${path.cropRegion ? (() => {
  try {
    let cr = JSON.parse(path.cropRegion!);
    if (typeof cr === 'string') cr = JSON.parse(cr);
    const [x, y, w, h] = cr;
    return `python3 -c "from PIL import Image; img=Image.open('$TMP'); img.crop((${x},${y},${x + w},${y + h})).save('$OUT')"`;
  } catch { return `cp "$TMP" "$OUT"`; }
})() : `cp "$TMP" "$OUT"`}
rm -f "$TMP"
echo "saved $OUT"
`, { mode: 0o755 });

      // ── Pre-compute baseline screenshot and diff ──
      let baselineScore = 'N/A';
      try {
        // Wait 5 seconds for vite to be ready
        execSync('sleep 5');
        // Take baseline screenshot
        execSync(`bash ${childDir}/snap.sh ${childDir}/baseline.png`, {
          stdio: 'pipe', timeout: 30_000,
        });
        console.log(`[fafo] Baseline screenshot taken for ${path.name}`);
        // Compute fitness if target exists
        if (existsSync(`${runRoot}/target.png`)) {
          const cropArg = path.cropRegion ? (() => {
            try {
              let cr = JSON.parse(path.cropRegion!);
              if (typeof cr === 'string') cr = JSON.parse(cr);
              return `--crop ${cr.join(',')}`;
            } catch { return ''; }
          })() : '';
          const diffOutput = execSync(
            `python3 ${runRoot}/fitness.py ${runRoot}/target.png ${childDir}/baseline.png ${cropArg}`,
            { encoding: 'utf-8', timeout: 30_000 },
          ).trim();
          try {
            const diffData = JSON.parse(diffOutput);
            baselineScore = String(diffData.composite);
            writeFileSync(`${childDir}/diff-baseline.json`, diffOutput);
          } catch { baselineScore = diffOutput; }
        }
        console.log(`[fafo] Baseline diff score for ${path.name}: ${baselineScore}`);
      } catch (err: any) {
        console.warn(`[fafo] Baseline screenshot/diff failed for ${path.name}:`, err.message);
      }

      // ── Determine wiki files relevant to this path ──
      const wikiDir = `${runRoot}/wiki`;
      const wikiFilesForPath: string[] = [];
      const pathNameLower = path.name.toLowerCase();
      if (pathNameLower.includes('horn') || pathNameLower.includes('pill')) {
        wikiFilesForPath.push(`${wikiDir}/coordinates.md`, `${wikiDir}/style-params.md`);
      } else if (pathNameLower.includes('port') || pathNameLower.includes('text')) {
        wikiFilesForPath.push(`${wikiDir}/style-params.md`, `${wikiDir}/what-works.md`);
      } else if (pathNameLower.includes('entry') || pathNameLower.includes('wire')) {
        wikiFilesForPath.push(`${wikiDir}/coordinates.md`, `${wikiDir}/what-works.md`);
      } else {
        // Default: give all wiki files
        wikiFilesForPath.push(`${wikiDir}/what-works.md`, `${wikiDir}/coordinates.md`, `${wikiDir}/style-params.md`);
      }

      // Build prompt from path config + knowledge
      let files: string[] = [];
      if (path.files) {
        try {
          let parsed = JSON.parse(path.files);
          // Handle double-encoded JSON strings
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
          files = Array.isArray(parsed) ? parsed : [];
        } catch { files = []; }
      }

      // Extract code snippet if focusLines specified
      let codeSnippetSection = '';
      if (path.focusLines && files.length > 0) {
        const primaryFile = files[0].startsWith('/') ? files[0] : `${workDir}/${files[0]}`;
        if (existsSync(primaryFile)) {
          const snippet = extractLines(primaryFile, path.focusLines);
          if (snippet && snippet !== '(could not extract lines)') {
            codeSnippetSection = `## Current code (lines ${path.focusLines})\n\`\`\`tsx\n${snippet}\n\`\`\``;
          }
        }
      }

      const promptParts = [
        `You are FAFO Gen ${nextGen} worker "${path.name}". You have your OWN vite on port ${port}.`,
        `Edit files ONLY in your worktree at: ${workDir}`,
        '',
        `## IMPORTANT: The code already has harness rendering. Do NOT start from scratch.`,
        `The SchematicRenderer.tsx already renders harness connectors (Layer 11.5), signal harness wires with pill connectors, ports with hexagonal shapes, entry dots, etc. Your job is to REFINE the existing rendering to better match the target image. Do NOT rebuild or remove existing harness code.`,
        '',
        `## Pre-computed baseline`,
        `- Baseline screenshot: ${childDir}/baseline.png (Read this with Read tool to see current state)`,
        `- Target image: ${runRoot}/target.png (Read this to see what we're matching)`,
        `- Baseline diff score: ${baselineScore} (lower = closer to target)`,
        '',
        `Start by comparing these two images visually. DO NOT take your own screenshot first — use the baseline.`,
        '',
        `## Your specific task`,
        path.prompt,
        '',
        files.length > 0 ? `## Focus files\n${files.join('\n')}` : '',
        path.focusLines ? `## Focus lines: ${path.focusLines}` : '',
        codeSnippetSection,
        '',
        `## Wiki knowledge`,
        `Read these wiki files for context relevant to your task:`,
        ...wikiFilesForPath.map(f => `- ${f}`),
        `After completing your work, update the wiki files with what you learned:`,
        `- ${wikiDir}/what-works.md — if your changes improved the score`,
        `- ${wikiDir}/what-fails.md — if your changes made things worse`,
        '',
        `## Workflow: Compare baseline to target, then make targeted edits`,
        `1. Read the baseline screenshot: ${childDir}/baseline.png`,
        `2. Read the target image: ${runRoot}/target.png`,
        `3. Compare visually, identify SPECIFIC differences (shape, color, position, size)`,
        `4. Make ONE focused edit to ${workDir}/src/components/SchematicRenderer.tsx`,
        `5. Wait 2 seconds for HMR, then take a screenshot: bash ${childDir}/snap.sh ${childDir}/after.png`,
        `6. Measure fitness: python3 ${runRoot}/fitness.py ${runRoot}/target.png ${childDir}/after.png`,
        `   The fitness script returns: composite (overall, lower=better), ssim (structural similarity),`,
        `   edge_iou (structural element match), hist_corr (color match), pixel_mean (raw pixel diff).`,
        `   Focus on improving SSIM and edge_iou — they measure rendering quality, not position alignment.`,
        `7. Repeat steps 4-6 up to 15 times. Each iteration: ONE change → screenshot → measure.`,
        `   Keep changes that lower the composite score. Revert changes that increase it.`,
        `   After every 3 iterations, save a checkpoint: write ${childDir}/checkpoint-N.json with`,
        `   the current fitness scores and a one-line description of what was tried.`,
        '',
        existsSync(`${runRoot}/KNOWLEDGE.md`) ? `## Knowledge from prior generations\nRead ${runRoot}/KNOWLEDGE.md for important context and lessons learned.` : '',
        existsSync(`${runRoot}/wiki/approach-log.md`) ? `## Approach log (DO NOT repeat these)\nRead ${runRoot}/wiki/approach-log.md to see what has already been tried across generations.` : '',
        existsSync(`${runRoot}/wiki/task-assignments.md`) ? `## Directed task assignments\nRead ${runRoot}/wiki/task-assignments.md for specific sub-problems assigned to your path.` : '',
        '',
        `## Output`,
        `Write status.json with these fields: {"diff_score": <composite>, "ssim": <ssim>, "edge_iou": <edge_iou>, "hist_corr": <hist_corr>}`,
        `Write summary.md in ${childDir}/ describing what you tried and what worked/failed.`,
        `Update wiki files: ${runRoot}/wiki/what-works.md and ${runRoot}/wiki/what-fails.md with your learnings.`,
      ];
      const fullPrompt = promptParts.filter(Boolean).join('\n');
      writeFileSync(`${childDir}/prompt.md`, fullPrompt);

      // Create a wiggum run record
      const runId = ulid();
      const parentRun = survivors[path.order % Math.max(survivors.length, 1)];
      db.insert(schema.wiggumRuns).values({
        id: runId,
        harnessConfigId: swarm.harnessConfigId || null,
        appId: swarm.appId || null,
        prompt: fullPrompt,
        swarmId: swarm.id,
        pathId: path.id,
        generation: nextGen,
        parentRunId: parentRun?.id || null,
        knobs: JSON.stringify({ port, branch: `${branch}-g${nextGen}`, worktree: workDir }),
        status: 'pending',
        currentIteration: 0,
        iterations: '[]',
        maxIterations: 20,
        screenshotDelayMs: 3000,
        createdAt: now,
        updatedAt: now,
      }).run();

      // Dispatch Claude session for this path
      try {
        // Create a feedback item to anchor the agent session
        const fbId = ulid();
        db.insert(schema.feedbackItems).values({
          id: fbId,
          type: 'manual',
          status: 'new',
          title: `FAFO Gen ${nextGen}: ${path.name}`,
          description: `Worker for swarm "${swarm.name}", path "${path.name}"`,
          appId: swarm.appId || null,
          createdAt: now,
          updatedAt: now,
        }).run();

        // Find the default agent endpoint
        const agents = db.select().from(schema.agentEndpoints).all();
        const appAgent = swarm.appId ? agents.find(a => a.isDefault && a.appId === swarm.appId) : null;
        const globalAgent = agents.find(a => a.isDefault && !a.appId);
        const agent = appAgent || globalAgent || agents[0];

        if (!agent) {
          throw new Error('No agent endpoints configured — create one in Settings > Agents');
        }

        const { sessionId } = await dispatchAgentSession({
          feedbackId: fbId,
          agentEndpointId: agent.id,
          prompt: fullPrompt,
          cwd: workDir,
          permissionProfile: 'yolo',
        });

        // Update run with session ID
        db.update(schema.wiggumRuns)
          .set({ status: 'running', sessionId, startedAt: now, updatedAt: now })
          .where(eq(schema.wiggumRuns.id, runId)).run();

        console.log(`[fafo] Dispatched worker "${path.name}" as session ${sessionId}`);
      } catch (err: any) {
        console.error(`[fafo] Failed to dispatch worker for ${path.name}:`, err.message);
        db.update(schema.wiggumRuns)
          .set({ status: 'failed', errorMessage: err.message, updatedAt: now })
          .where(eq(schema.wiggumRuns.id, runId)).run();
      }

      const row = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, runId)).get();
      if (row) newRuns.push({ ...row, iterations: JSON.parse(row.iterations || '[]') });
      worktrees.push({ path: workDir, port, branch: `${branch}-g${nextGen}` });
    }
  } else {
    // ── Single-mode: fan-out N identical runs with varied knobs ──
    const fanOut = opts.fanOut ?? swarm.fanOut;
    for (let i = 0; i < fanOut; i++) {
      const runId = ulid();
      const parentRun = survivors[i % Math.max(survivors.length, 1)];
      const prompt = swarm.promptFile
        ? `[FAFO Gen ${nextGen}, Slot ${i}] ${swarm.promptFile}`
        : `[FAFO Gen ${nextGen}, Slot ${i}] No prompt configured`;

      db.insert(schema.wiggumRuns).values({
        id: runId,
        harnessConfigId: swarm.harnessConfigId || null,
        appId: swarm.appId || null,
        prompt,
        swarmId: swarm.id,
        generation: nextGen,
        parentRunId: parentRun?.id || null,
        knobs: JSON.stringify({ ...(opts.knobs || {}), slot: i }),
        status: 'pending',
        currentIteration: 0,
        iterations: '[]',
        maxIterations: 20,
        screenshotDelayMs: 3000,
        createdAt: now,
        updatedAt: now,
      }).run();

      if (swarm.harnessConfigId) {
        // Harness-based: start via wiggum controller
        startWiggumRun(runId).catch(err => {
          console.error(`[fafo] Failed to start run ${runId}:`, err.message);
        });
      } else {
        // No harness: dispatch directly via agent session (local or remote launcher)
        try {
          const agents = db.select().from(schema.agentEndpoints).all();
          const appAgent = swarm.appId ? agents.find(a => a.isDefault && a.appId === swarm.appId) : null;
          const globalAgent = agents.find(a => a.isDefault && !a.appId);
          const agent = appAgent || globalAgent || agents[0];
          if (!agent) throw new Error('No agent endpoints configured');

          const fbId = ulid();
          db.insert(schema.feedbackItems).values({
            id: fbId,
            type: 'manual',
            status: 'new',
            title: `FAFO Gen ${nextGen}, Slot ${i}: ${swarm.name}`,
            description: `Single-mode worker for swarm "${swarm.name}"`,
            appId: swarm.appId || null,
            createdAt: now,
            updatedAt: now,
          }).run();

          db.update(schema.wiggumRuns)
            .set({ feedbackId: fbId })
            .where(eq(schema.wiggumRuns.id, runId)).run();

          const { sessionId } = await dispatchAgentSession({
            feedbackId: fbId,
            agentEndpointId: agent.id,
            prompt,
            cwd: repoDir,
            permissionProfile: 'yolo',
          });

          db.update(schema.wiggumRuns)
            .set({ status: 'running', sessionId, startedAt: now, updatedAt: now })
            .where(eq(schema.wiggumRuns.id, runId)).run();

          console.log(`[fafo] Dispatched single-mode worker slot ${i} as session ${sessionId}`);
        } catch (err: any) {
          console.error(`[fafo] Failed to dispatch single-mode worker slot ${i}:`, err.message);
          db.update(schema.wiggumRuns)
            .set({ status: 'failed', errorMessage: err.message, updatedAt: now })
            .where(eq(schema.wiggumRuns.id, runId)).run();
        }
      }

      const row = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, runId)).get();
      if (row) newRuns.push({ ...row, iterations: JSON.parse(row.iterations || '[]') });
    }
  }

  const updatedSwarm = db.select().from(schema.wiggumSwarms)
    .where(eq(schema.wiggumSwarms.id, swarmId)).get();

  return {
    swarm: updatedSwarm,
    generation: nextGen,
    survivors: survivors.map(r => r.id),
    dropped: dropped.map(r => r.id),
    newRuns,
    worktrees,
  };
}

/**
 * Clean up worktrees for a swarm generation.
 */
export function cleanupWorktrees(swarmId: string) {
  const paths = db.select().from(schema.wiggumSwarmPaths)
    .where(eq(schema.wiggumSwarmPaths.swarmId, swarmId)).all();

  for (const path of paths) {
    if (path.worktreePath && existsSync(path.worktreePath)) {
      try {
        // Kill vite if running
        const pidFile = resolve(dirname(path.worktreePath), 'vite.pid');
        if (existsSync(pidFile)) {
          const pid = parseInt(readFileSync(pidFile, 'utf-8').trim());
          if (pid) try { process.kill(pid); } catch { /* already dead */ }
        }
        // Remove worktree
        const repoDir = resolve(path.worktreePath, '..', '..'); // guess repo parent
        execSync(`git -C "${repoDir}" worktree remove "${path.worktreePath}" --force 2>/dev/null || rm -rf "${path.worktreePath}"`, {
          stdio: 'pipe', timeout: 15_000,
        });
      } catch (err: any) {
        console.warn(`[fafo] Cleanup failed for ${path.name}:`, err.message);
      }
    }
  }
}

/**
 * Run the aggregator agent between generations.
 * Reads all worker results, distills knowledge, produces directed task assignments.
 * Returns the sessionId of the aggregator so the poller can wait for it.
 */
const pendingAggregators = new Map<string, { sessionId: string; runRoot: string }>();

async function runAggregatorAgent(swarmId: string, runRoot: string): Promise<string | null> {
  const swarm = db.select().from(schema.wiggumSwarms)
    .where(eq(schema.wiggumSwarms.id, swarmId)).get();
  if (!swarm) return null;

  const currentGen = swarm.generationCount;
  const wikiDir = `${runRoot}/wiki`;

  // Collect all worker summaries, fitness scores, and wiki updates
  const childDirs: string[] = [];
  try {
    const entries = execSync(`ls -d ${runRoot}/child-* 2>/dev/null || true`, { encoding: 'utf-8' })
      .trim().split('\n').filter(Boolean);
    childDirs.push(...entries);
  } catch { /* ignore */ }

  const workerResults: string[] = [];
  for (const childDir of childDirs) {
    const name = childDir.split('/').pop()?.replace('child-', '') || 'unknown';
    let summary = '', statusJson = '', checkpoints = '';

    try { summary = readFileSync(`${childDir}/summary.md`, 'utf-8'); } catch { summary = '(no summary)'; }
    try { statusJson = readFileSync(`${childDir}/status.json`, 'utf-8'); } catch { statusJson = '(no status)'; }

    // Collect checkpoints
    try {
      const cpFiles = execSync(`ls ${childDir}/checkpoint-*.json 2>/dev/null || true`, { encoding: 'utf-8' })
        .trim().split('\n').filter(Boolean);
      const cpData = cpFiles.map(f => { try { return readFileSync(f, 'utf-8'); } catch { return ''; } }).filter(Boolean);
      if (cpData.length > 0) checkpoints = `\nCheckpoints:\n${cpData.join('\n')}`;
    } catch { /* ignore */ }

    workerResults.push(`### Worker: ${name}\nStatus: ${statusJson}\nSummary:\n${summary}${checkpoints}\n`);
  }

  // Collect human feedback for this generation
  let humanFeedback = '';
  try {
    const feedback = db.select().from(schema.fafoFeedback)
      .where(eq(schema.fafoFeedback.swarmId, swarmId))
      .all()
      .filter(f => f.generation === currentGen || f.generation === null);
    if (feedback.length > 0) {
      humanFeedback = '\n## Human Feedback (PRIORITY — these override automated metrics)\n' +
        feedback.map(f => {
          const rating = f.rating === 1 ? 'GOOD' : f.rating === -1 ? 'BAD' : 'NEUTRAL';
          const region = f.regionX != null ? ` [region: ${f.regionX},${f.regionY},${f.regionW},${f.regionH}]` : '';
          return `- ${rating}${region}: ${f.annotation || '(no annotation)'}`;
        }).join('\n');
    }
  } catch { /* ignore */ }

  // Read current wiki files
  const wikiFiles = ['what-works.md', 'what-fails.md', 'coordinates.md', 'style-params.md',
                     'open-questions.md', 'approach-log.md', 'task-status.md'];
  const wikiContent = wikiFiles.map(f => {
    try { return `### ${f}\n${readFileSync(`${wikiDir}/${f}`, 'utf-8')}`; }
    catch { return `### ${f}\n(empty)`; }
  }).join('\n\n');

  // Get paths for task assignment
  const paths = db.select().from(schema.wiggumSwarmPaths)
    .where(eq(schema.wiggumSwarmPaths.swarmId, swarmId))
    .all()
    .sort((a, b) => a.order - b.order);
  const pathNames = paths.map(p => p.name).join(', ');

  const aggregatorPrompt = `You are the FAFO Aggregator for Gen ${currentGen} of swarm "${swarm.name}".
Your job is to read ALL worker results from this generation, distill knowledge, and produce directed task assignments for the next generation.

## Worker Results
${workerResults.join('\n')}
${humanFeedback}

## Current Wiki State
${wikiContent}

## Available Worker Paths for Next Generation
${pathNames}

## Your Tasks

1. **Update wiki/what-works.md**: Distill and DEDUPLICATE techniques that improved scores. Remove outdated entries. Be specific — include exact parameter values.

2. **Update wiki/what-fails.md**: Distill approaches that made things worse. Include WHY they failed.

3. **Update wiki/coordinates.md**: Update with any new coordinate/position data from workers.

4. **Update wiki/style-params.md**: Update with any new style parameters discovered.

5. **Append to wiki/approach-log.md**: Add ALL approaches tried this generation (both successful and failed) in format:
   - Gen ${currentGen} / <worker-name>: <approach description> → <result: improved/worsened/neutral> (composite: X → Y)

6. **Write wiki/task-assignments.md**: Create SPECIFIC, MEASURABLE sub-tasks for each worker path in the next generation. Format:
   ## Task: <descriptive-name>
   - Assigned to: <path-name>
   - Acceptance criteria: <metric> > <value> (currently <current-value>)
   - Crop region: [x, y, w, h] (if applicable)
   - What to try: <specific approach with parameter values>
   - What NOT to try: <approaches that have already failed>
   - Max iterations for this sub-task: <number>

7. **Update wiki/task-status.md**: Mark which tasks from previous generation are DONE vs OPEN.

## Rules
- Be concise and specific — workers have limited context
- Human feedback takes PRIORITY over automated metrics
- Include exact numbers (fitness scores, pixel coordinates, parameter values)
- Don't repeat approaches that are already in approach-log.md

Write all files to: ${wikiDir}/
Then write a brief summary to ${runRoot}/aggregator-summary.md
`;

  // Dispatch the aggregator as a Claude session
  try {
    const agents = db.select().from(schema.agentEndpoints).all();
    const appAgent = swarm.appId ? agents.find(a => a.isDefault && a.appId === swarm.appId) : null;
    const globalAgent = agents.find(a => a.isDefault && !a.appId);
    const agent = appAgent || globalAgent || agents[0];
    if (!agent) {
      console.error('[fafo] No agent endpoint for aggregator');
      return null;
    }

    const now = new Date().toISOString();
    const fbId = ulid();
    db.insert(schema.feedbackItems).values({
      id: fbId, type: 'manual', status: 'new',
      title: `FAFO Aggregator Gen ${currentGen}: ${swarm.name}`,
      description: `Aggregator agent distilling knowledge from gen ${currentGen}`,
      appId: swarm.appId || null,
      createdAt: now, updatedAt: now,
    }).run();

    const { sessionId } = await dispatchAgentSession({
      feedbackId: fbId,
      agentEndpointId: agent.id,
      prompt: aggregatorPrompt,
      cwd: runRoot,
      permissionProfile: 'yolo',
    });

    console.log(`[fafo] Dispatched aggregator for gen ${currentGen} as session ${sessionId}`);
    pendingAggregators.set(swarmId, { sessionId, runRoot });
    return sessionId;
  } catch (err: any) {
    console.error(`[fafo] Failed to dispatch aggregator:`, err.message);
    return null;
  }
}

/**
 * Run optional meta-manager after aggregator completes.
 * Reads worker session logs, identifies wasted effort, suggests prompt optimizations.
 */
async function runMetaManager(swarmId: string, runRoot: string): Promise<string | null> {
  const swarm = db.select().from(schema.wiggumSwarms)
    .where(eq(schema.wiggumSwarms.id, swarmId)).get();
  if (!swarm) return null;

  const currentGen = swarm.generationCount;

  // Collect worker session IDs and their token/time stats
  const currentRuns = db.select().from(schema.wiggumRuns)
    .where(eq(schema.wiggumRuns.swarmId, swarmId))
    .all()
    .filter(r => r.generation === currentGen);

  const sessionSummaries: string[] = [];
  for (const run of currentRuns) {
    if (!run.sessionId) continue;
    try {
      const resp = await fetch(`http://localhost:3001/api/v1/admin/agent-sessions/${run.sessionId}`);
      const sess = await resp.json() as any;
      const pathName = (() => {
        if (!run.pathId) return 'unknown';
        const path = db.select().from(schema.wiggumSwarmPaths).where(eq(schema.wiggumSwarmPaths.id, run.pathId)).get();
        return path?.name || 'unknown';
      })();
      sessionSummaries.push(
        `### Worker "${pathName}" (session ${run.sessionId.slice(0, 8)})\n` +
        `- Status: ${sess.status}\n` +
        `- Output bytes: ${sess.outputBytes || 'unknown'}\n` +
        `- Duration: ${sess.startedAt && sess.completedAt ? `${Math.round((new Date(sess.completedAt).getTime() - new Date(sess.startedAt).getTime()) / 1000)}s` : 'unknown'}\n` +
        `- Fitness: ${run.fitnessScore ?? 'N/A'}\n` +
        `- Iterations completed: ${run.currentIteration}/${run.maxIterations}\n`
      );
    } catch { /* ignore */ }
  }

  if (sessionSummaries.length === 0) return null;

  // Read aggregator summary if it exists
  let aggSummary = '';
  try { aggSummary = readFileSync(`${runRoot}/aggregator-summary.md`, 'utf-8'); } catch { /* ignore */ }

  const metaPrompt = `You are the FAFO Meta-Manager for Gen ${currentGen} of swarm "${swarm.name}".
Your job is to analyze worker efficiency and recommend prompt/strategy improvements.

## Worker Session Stats
${sessionSummaries.join('\n')}

${aggSummary ? `## Aggregator Summary\n${aggSummary}\n` : ''}

## Your Tasks

1. **Identify wasted effort**: Which workers spent disproportionate time/tokens? What were they doing that wasn't productive?

2. **Identify convergence patterns**: Are scores improving generation-over-generation? Which paths are making progress? Which are stuck?

3. **Write wiki/meta-observations.md** with:
   - Token efficiency breakdown per worker
   - Common failure patterns (e.g., "workers spend 40% reading files already in wiki")
   - Recommended prompt modifications (be specific — add/remove/reword sections)
   - Strategy adjustments (should paths be renamed? should tasks be redistributed?)
   - Convergence assessment: are we on track? what's the expected trajectory?

4. **Optionally write wiki/prompt-rewrites.md** if you think worker prompts need significant changes.
   Format each section with the path name as header:
   ## horn-pill
   <rewritten prompt text>
   ## entry-wires
   <rewritten prompt text>

Write all files to: ${runRoot}/wiki/
`;

  try {
    const agents = db.select().from(schema.agentEndpoints).all();
    const agent = agents.find(a => a.isDefault && (!a.appId || a.appId === swarm.appId)) || agents[0];
    if (!agent) return null;

    const now = new Date().toISOString();
    const fbId = ulid();
    db.insert(schema.feedbackItems).values({
      id: fbId, type: 'manual', status: 'new',
      title: `FAFO Meta-Manager Gen ${currentGen}: ${swarm.name}`,
      description: `Meta-manager analyzing worker efficiency for gen ${currentGen}`,
      appId: swarm.appId || null,
      createdAt: now, updatedAt: now,
    }).run();

    const { sessionId } = await dispatchAgentSession({
      feedbackId: fbId,
      agentEndpointId: agent.id,
      prompt: metaPrompt,
      cwd: runRoot,
      permissionProfile: 'yolo',
    });

    console.log(`[fafo] Dispatched meta-manager for gen ${currentGen} as session ${sessionId}`);
    return sessionId;
  } catch (err: any) {
    console.error(`[fafo] Failed to dispatch meta-manager:`, err.message);
    return null;
  }
}

/**
 * Poll running swarms and auto-advance to the next generation when all
 * runs in the current generation have completed, up to maxGenerations.
 * Now includes aggregator step between generations.
 */
let pollerRunning = false;
export function startFAFOPoller(intervalMs = 15_000) {
  if (pollerRunning) return;
  pollerRunning = true;
  console.log(`[fafo] Auto-advance poller started (every ${intervalMs / 1000}s)`);

  setInterval(async () => {
    try {
      const swarms = db.select().from(schema.wiggumSwarms)
        .where(eq(schema.wiggumSwarms.status, 'running'))
        .all();

      for (const swarm of swarms) {
        const maxGen = (swarm as any).maxGenerations;
        if (maxGen == null) continue; // manual-only swarm
        if (swarm.generationCount >= maxGen) {
          // Reached limit — mark completed
          db.update(schema.wiggumSwarms)
            .set({ status: 'completed', updatedAt: new Date().toISOString() })
            .where(eq(schema.wiggumSwarms.id, swarm.id)).run();
          console.log(`[fafo] Swarm "${swarm.name}" reached max generation ${maxGen}, marking completed`);
          continue;
        }

        // Check if all runs in current generation are done
        const currentRuns = db.select().from(schema.wiggumRuns)
          .where(eq(schema.wiggumRuns.swarmId, swarm.id))
          .all()
          .filter(r => r.generation === swarm.generationCount);

        if (currentRuns.length === 0) continue; // no runs yet

        // Sync run status from session status for any "running" runs
        for (const run of currentRuns) {
          if (run.status !== 'running' || !run.sessionId) continue;
          try {
            const resp = await fetch(`http://localhost:3001/api/v1/admin/agent-sessions/${run.sessionId}`);
            const sess = await resp.json() as any;
            if (sess.status === 'completed' || sess.status === 'failed' || sess.status === 'killed') {
              const newStatus = sess.status === 'completed' ? 'completed' : 'failed';
              db.update(schema.wiggumRuns)
                .set({ status: newStatus, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
                .where(eq(schema.wiggumRuns.id, run.id)).run();
              run.status = newStatus;
            }
          } catch { /* session-service may be unavailable */ }
        }

        const allDone = currentRuns.every(r =>
          r.status === 'completed' || r.status === 'failed' || r.status === 'killed'
        );

        if (!allDone) continue; // still running

        // Check if aggregator is pending for this swarm
        const pending = pendingAggregators.get(swarm.id);
        if (pending) {
          // Check if aggregator session has completed
          try {
            const resp = await fetch(`http://localhost:3001/api/v1/admin/agent-sessions/${pending.sessionId}`);
            const sess = await resp.json() as any;
            if (sess.status === 'completed' || sess.status === 'failed' || sess.status === 'killed') {
              console.log(`[fafo] Aggregator for "${swarm.name}" completed (${sess.status})`);
              pendingAggregators.delete(swarm.id);
              // Fire-and-forget meta-manager (don't block advancement)
              runMetaManager(swarm.id, pending.runRoot).catch(err =>
                console.warn(`[fafo] Meta-manager failed:`, err.message)
              );
              // Advance to next generation
              try {
                await startFAFOGeneration(swarm.id, { keepCount: 1 });
              } catch (err: any) {
                console.error(`[fafo] Auto-advance failed for swarm "${swarm.name}":`, err.message);
              }
            } else {
              console.log(`[fafo] Waiting for aggregator session ${pending.sessionId.slice(0, 8)}...`);
            }
          } catch { /* session-service unavailable */ }
          continue;
        }

        // All workers done, no aggregator pending — dispatch aggregator first
        console.log(`[fafo] Swarm "${swarm.name}" gen ${swarm.generationCount} complete (${currentRuns.length} runs), dispatching aggregator...`);

        // Find the run root for this generation
        try {
          const parentDir = '/tmp/fafo-runs';
          const prefix = `swarm-${swarm.id.slice(-8)}-gen${swarm.generationCount}-`;
          const entries = execSync(`ls -d ${parentDir}/${prefix}* 2>/dev/null || true`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
          if (entries.length > 0) {
            const runRoot = entries[entries.length - 1];
            const aggSessionId = await runAggregatorAgent(swarm.id, runRoot);
            if (!aggSessionId) {
              // Aggregator failed to dispatch — advance without it
              console.warn(`[fafo] Aggregator failed, advancing directly`);
              await startFAFOGeneration(swarm.id, { keepCount: 1 });
            }
          } else {
            // Can't find run root — advance without aggregator
            console.warn(`[fafo] Can't find run root for gen ${swarm.generationCount}, advancing directly`);
            await startFAFOGeneration(swarm.id, { keepCount: 1 });
          }
        } catch (err: any) {
          console.error(`[fafo] Auto-advance failed for swarm "${swarm.name}":`, err.message);
        }
      }
    } catch (err: any) {
      console.error(`[fafo] Poller error:`, err.message);
    }
  }, intervalMs);
}
