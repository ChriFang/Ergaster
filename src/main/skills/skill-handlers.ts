import { ipcMain, shell } from 'electron';
import { userSkillsService } from './user-skills-service';
import type { SkillListItem, CreateSkillRequest, UpdateSkillRequest, SkillOperationResult } from '../../shared/skill-contracts';

export function registerSkillHandlers() {
  ipcMain.handle('skill:list', async (): Promise<SkillListItem[]> => {
    return userSkillsService.getSkillListItems();
  });

  ipcMain.handle('skill:get', async (_event, skillName: string) => {
    const skill = userSkillsService.getSkill(skillName);
    if (!skill) {
      return null;
    }

    return {
      name: skill.metadata.name,
      description: skill.metadata.description,
      content: skill.content,
      directoryName: skill.directoryName,
      directoryPath: skill.directoryPath,
    };
  });

  ipcMain.handle('skill:create', async (_event, request: CreateSkillRequest): Promise<SkillOperationResult> => {
    return userSkillsService.createSkill(request);
  });

  ipcMain.handle('skill:update', async (_event, request: UpdateSkillRequest): Promise<SkillOperationResult> => {
    return userSkillsService.updateSkill(request.directoryName, request);
  });

  ipcMain.handle('skill:delete', async (_event, directoryName: string): Promise<SkillOperationResult> => {
    return userSkillsService.deleteSkill(directoryName);
  });

  ipcMain.handle('skill:reload', async (): Promise<SkillOperationResult> => {
    try {
      await userSkillsService.reloadSkills();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '重新加载失败' };
    }
  });

  ipcMain.handle('skill:get-directory', async (): Promise<string> => {
    return userSkillsService.getSkillsDirectory();
  });

  ipcMain.handle('skill:open-directory', async (): Promise<void> => {
    const dir = userSkillsService.getSkillsDirectory();
    await shell.openPath(dir);
  });

  ipcMain.handle('skill:get-template', async (): Promise<string> => {
    return [
      '# Skill Title',
      '',
      '## Overview',
      '',
      'Describe what this skill does and when to use it.',
      '',
      '## Instructions',
      '',
      '### Step 1',
      '',
      'Detailed instructions for step 1.',
      '',
      '### Step 2',
      '',
      'Detailed instructions for step 2.',
      '',
      '## Parameters',
      '',
      'If this skill accepts parameters, describe them here:',
      '',
      '- `param1`: Description of parameter 1',
      '- `param2`: Description of parameter 2',
      '',
      '## Examples',
      '',
      'Provide examples of how to use this skill.',
      '',
      '### Example 1',
      '',
      '```',
      'Input: ...',
      'Output: ...',
      '```',
      '',
      '## Notes',
      '',
      'Additional notes or caveats.',
      '',
    ].join('\n');
  });
}
