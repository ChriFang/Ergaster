import type { ToolRisk } from './tools';

export type SkillMetadata = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: {
    author?: string;
    version?: string;
    execute?: SkillExecuteConfig;
    risk?: ToolRisk;
    [key: string]: unknown;
  };
  allowedTools?: string;
};

export type SkillExecuteConfig =
  | {
      type: 'http';
      timeout?: number;
      http: {
        url: string;
        method: 'GET' | 'POST';
        headers?: Record<string, string>;
        body?: string;
      };
    }
  | {
      type: 'script';
      timeout?: number;
      script: {
        command: string;
        args?: string[];
      };
    }
  | {
      type: 'tool';
      timeout?: number;
      tool: {
        name: string;
        arguments?: Record<string, unknown>;
      };
    };

export type UserSkillDefinition = {
  metadata: SkillMetadata;
  content: string;
  directoryName: string;
  directoryPath: string;
  filePath: string;
  risk: ToolRisk;
};

export type SkillParameters = {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
    required?: boolean;
  }>;
  required?: string[];
};

/** 安装 Skill 时下载到内存的单个文件。文本文件带 text（供扫描），二进制文件带 contentBase64。 */
export type InstalledSkillFile = {
  /** 相对 Skill 根目录的 posix 路径，已消毒（无绝对路径、无 `..` 逃逸）。 */
  relativePath: string;
  /** 文本文件内容（utf-8）。与 contentBase64 二选一。 */
  text?: string;
  /** 二进制文件内容（base64）。与 text 二选一。 */
  contentBase64?: string;
};

/** 安全扫描的单条发现。block 级会阻断安装，warn 级仅提示并计入风险分。 */
export type ScanFinding = {
  severity: 'info' | 'warn' | 'block';
  /** 规则码，如 PIPE_TO_SHELL / DESTRUCTIVE_CMD / SECRET / INJECTION / EXECUTE_SCRIPT / TYPOSQUAT。 */
  code: string;
  message: string;
  /** 命中文件的相对路径（正文命中时为 SKILL.md）。 */
  file?: string;
};

/** 安全扫描汇总结果。 */
export type ScanReport = {
  score: number;
  findings: ScanFinding[];
  blocked: boolean;
};

/** 归一化后的安装来源。 */
export type ResolvedSource =
  | { kind: 'raw-md'; url: string }
  | { kind: 'zip'; url: string }
  | {
      kind: 'github';
      owner: string;
      repo: string;
      /** 分支 / tag / commit；未显式给出时为 'HEAD'。 */
      ref: string;
      /** 仓库内 Skill 子目录（posix，仓库根为空串）。 */
      subdir: string;
    };
