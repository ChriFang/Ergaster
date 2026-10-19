import { RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type SkillEditorPayload = {
  name: string;
  description: string;
  content: string;
};

type Props = {
  name: string;
  description: string;
  content: string;
  isCreating: boolean;
  onSave: (payload: SkillEditorPayload) => Promise<void>;
  onCancel: () => void;
};

export function SkillEditor({ name: initialName, description: initialDescription, content: initialContent, isCreating, onSave, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<string>('');

  useEffect(() => {
    setName(initialName);
    setDescription(initialDescription);
    setContent(initialContent);
  }, [initialName, initialDescription, initialContent]);

  useEffect(() => {
    window.desktopApp.getSkillTemplate().then(setTemplate).catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      alert('Skill 名称不能为空');
      return;
    }

    if (!description.trim()) {
      alert('Skill 描述不能为空');
      return;
    }

    if (!content.trim()) {
      alert('Skill 内容不能为空');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        content,
      });
    } finally {
      setSaving(false);
    }
  }, [content, description, name, onSave]);

  const handleResetToTemplate = useCallback(() => {
    if (confirm('确定要重置正文为默认模板吗？当前正文内容将被替换。')) {
      setContent(template);
    }
  }, [template]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      void handleSave();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }, [handleSave, onCancel]);

  return (
    <div className="skill-editor settings-surface-card">
      <div className="editor-header">
        <div>
          <h3>{isCreating ? '创建 Skill' : '编辑 Skill'}</h3>
          <p className="settings-description">保留大文本框编辑正文，同时将名称和描述结构化保存到 frontmatter。</p>
        </div>
        <div className="editor-header-actions">
          <button type="button" className="ghost-button" onClick={handleResetToTemplate} disabled={saving}>
            <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
            <span>重置模板</span>
          </button>
        </div>
      </div>

      <div>
        <label className="field">
          <span>Skill 名称</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：meeting-summary"
            disabled={saving}
          />
        </label>
      </div>

      <label className="field">
        <span>概要描述</span>
        <input
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="说明这个 Skill 的适用场景与主要作用"
          disabled={saving}
        />
      </label>

      <div className="editor-content">
        <label className="field">
          <span>Skill 正文</span>
          <textarea
            className="skill-textarea"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="在此输入 Skill 正文内容..."
            spellCheck={false}
            disabled={saving}
          />
        </label>
      </div>

      <div className="editor-actions">
        <button type="button" className="save-button" onClick={() => void handleSave()} disabled={saving || !content.trim()}>
          {saving ? '保存中...' : '保存 Skill'}
        </button>
        <button type="button" className="cancel-button" onClick={onCancel} disabled={saving}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
          <span>取消</span>
        </button>
      </div>
    </div>
  );
}
