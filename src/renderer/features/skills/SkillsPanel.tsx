import { FilePenLine, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { SkillDetail } from '../../../shared/contracts';
import type { SkillListItem } from '../../../shared/skill-contracts';
import { SkillEditor } from './SkillEditor';

type Props = {
  onClose: () => void;
};

export function SkillsPanel({ onClose }: Props) {
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [editingSkill, setEditingSkill] = useState<SkillDetail | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void loadSkills();
    // 模型经 install_skill 安装或其他会话删除 Skill 后，主进程推送 skills:changed，直接重列（无需再 reload）
    return window.desktopApp.onSkillsChanged(() => {
      void window.desktopApp.listSkills().then(setSkills).catch(() => {});
    });
  }, []);

  async function loadSkills() {
    setLoading(true);
    try {
      const reloadResult = await window.desktopApp.reloadSkills();
      if (!reloadResult.ok) {
        throw new Error(reloadResult.error ?? '重新加载 Skills 失败');
      }

      const result = await window.desktopApp.listSkills();
      setSkills(result);
    } catch {
      showMessage('error', '加载 Skills 列表失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenDirectory() {
    try {
      await window.desktopApp.openSkillsDirectory();
    } catch {
      showMessage('error', '打开目录失败');
    }
  }

  async function handleDelete(skill: SkillListItem) {
    if (!confirm(`确定要删除 Skill "${skill.name}" 吗？\n\n这将删除整个目录及其内容。`)) {
      return;
    }

    try {
      const result = await window.desktopApp.deleteSkill(skill.directoryName);
      if (result.ok) {
        showMessage('success', `Skill "${skill.name}" 已删除`);
        await loadSkills();
      } else {
        showMessage('error', result.error ?? '删除失败');
      }
    } catch {
      showMessage('error', '删除失败');
    }
  }

  const handleEdit = useCallback(async (skill: SkillListItem) => {
    try {
      const fullSkill = await window.desktopApp.getSkill(skill.name);
      if (fullSkill) {
        setEditingSkill(fullSkill);
        setIsCreating(false);
      }
    } catch {
      showMessage('error', '加载 Skill 详情失败');
    }
  }, []);

  const handleCreate = useCallback(async () => {
    try {
      const template = await window.desktopApp.getSkillTemplate();
      setEditingSkill({
        name: '',
        description: '',
        content: template,
        directoryName: '',
        directoryPath: '',
      });
      setIsCreating(true);
    } catch {
      showMessage('error', '获取模板失败');
    }
  }, []);

  const handleSaveSkill = useCallback(async (payload: { name: string; description: string; content: string }) => {
    try {
      if (isCreating) {
        const result = await window.desktopApp.createSkill(payload);
        if (result.ok) {
          showMessage('success', 'Skill 创建成功');
          setEditingSkill(null);
          setIsCreating(false);
          await loadSkills();
        } else {
          showMessage('error', result.error ?? '创建失败');
        }
      } else if (editingSkill) {
        const result = await window.desktopApp.updateSkill({
          directoryName: editingSkill.directoryName,
          ...payload,
        });
        if (result.ok) {
          showMessage('success', 'Skill 更新成功');
          setEditingSkill(null);
          await loadSkills();
        } else {
          showMessage('error', result.error ?? '更新失败');
        }
      }
    } catch {
      showMessage('error', '保存失败');
    }
  }, [editingSkill, isCreating]);

  const handleCancelEdit = useCallback(() => {
    setEditingSkill(null);
    setIsCreating(false);
  }, []);

  

  

  

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  }

  return (
    <div className="skills-panel settings-surface-card">
      <div className="skills-header settings-page-header">
        <div>
          <h2>Skills 管理</h2>
          <p className="settings-description">管理自定义 Skills 的名称、描述与正文内容。</p>
        </div>
        <div className="skills-header-actions">
          <button className="ghost-button" type="button" onClick={handleOpenDirectory}>
            <FolderOpen size={15} strokeWidth={2} aria-hidden="true" />
            <span>打开目录</span>
          </button>
          {!editingSkill ? (
            <button className="create-button" type="button" onClick={handleCreate}>
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              <span>创建 Skill</span>
            </button>
          ) : null}
        </div>
      </div>

      {message ? <div className={`skills-message skills-message-${message.type}`}>{message.text}</div> : null}

      <div className={`skills-content${editingSkill ? ' skills-content-editor' : ''}`}>
        {editingSkill ? (
          <SkillEditor
            name={editingSkill.name}
            description={editingSkill.description}
            content={editingSkill.content}
            isCreating={isCreating}
            onSave={handleSaveSkill}
            onCancel={handleCancelEdit}
          />
        ) : (
          <>
            {loading ? (
              <div className="skills-loading">加载中...</div>
            ) : skills.length === 0 ? (
              <div className="skills-empty">
                <p>暂无自定义 Skills</p>
                <p>点击右上角按钮创建新的 Skill，或手动在目录中添加 `SKILL.md` 文件。</p>
              </div>
            ) : (
              <div className="skills-list">
                {skills.map((skill) => (
                  <div key={skill.directoryName} className="skill-item settings-list-item">
                    <div className="skill-info">
                      <h3 className="skill-name">{skill.name}</h3>
                      <p className="skill-description">{skill.description || '未填写 Skill 描述'}</p>
                    </div>
                    <div className="skill-actions skill-actions-icon-only">
                      <button className="edit-button icon-button" type="button" onClick={() => void handleEdit(skill)} aria-label={`编辑 ${skill.name}`}>
                        <FilePenLine size={15} strokeWidth={2} />
                      </button>
                      <button className="delete-button icon-button" type="button" onClick={() => void handleDelete(skill)} aria-label={`删除 ${skill.name}`}>
                        <Trash2 size={15} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
