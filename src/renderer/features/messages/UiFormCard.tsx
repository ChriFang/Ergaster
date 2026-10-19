import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ClipboardList } from 'lucide-react';
import type { UiFormSpec } from '../../../shared/ui-form';
import type { UiFormWidgetItem } from '../../lib/hooks/use-chat-session';
import { findMissingRequiredFields, type UiFormValues } from '../../lib/utils/ui-form-submit';

type UiFormCardProps = {
  item: UiFormWidgetItem;
  /** 有任意会话在后端执行时禁用提交（后端单例，一次只能跑一个 run）。 */
  disabled: boolean;
  onSubmit: (widgetId: string, values: UiFormValues) => void;
};

function buildInitialValues(spec: UiFormSpec): UiFormValues {
  const values: UiFormValues = {};
  for (const field of spec.fields) {
    values[field.name] = field.defaultValue ?? '';
  }
  return values;
}

/** 会话区交互式表单卡片：由 ui_form 工具推送，提交后作为新的用户消息发回模型。 */
export function UiFormCard({ item, disabled, onSubmit }: UiFormCardProps) {
  const spec = item.spec;
  const [values, setValues] = useState<UiFormValues>(() => buildInitialValues(spec));
  const [showErrors, setShowErrors] = useState(false);

  const missing = useMemo(() => new Set(findMissingRequiredFields(spec, values)), [spec, values]);
  const locked = item.submitted;
  const inputsDisabled = locked || disabled;

  function setField(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inputsDisabled) {
      return;
    }
    if (missing.size > 0) {
      setShowErrors(true);
      return;
    }
    onSubmit(spec.widgetId, values);
  }

  return (
    <article className="message message-assistant ui-form-card">
      <div className="message-row">
        <div className="message-avatar message-avatar-tool" aria-hidden="true">
          <ClipboardList size={16} strokeWidth={2} />
        </div>
        <div className="message-stack">
          <form className="message-card-shell ui-form-shell" onSubmit={handleSubmit}>
            <div className="ui-form-header">
              <span className="ui-form-title">{spec.title}</span>
              {locked ? <span className="ui-form-status">已提交</span> : null}
            </div>
            {spec.description ? <p className="ui-form-description">{spec.description}</p> : null}

            <div className="ui-form-fields">
              {spec.fields.map((field) => {
                const invalid = showErrors && missing.has(field.name);
                const fieldId = `${spec.widgetId}-${field.name}`;
                return (
                  <div key={field.name} className={`ui-form-field${invalid ? ' ui-form-field-invalid' : ''}`}>
                    <label className="ui-form-label" htmlFor={field.type === 'radio' ? undefined : fieldId}>
                      {field.label}
                      {field.required ? <span className="ui-form-required">*</span> : null}
                    </label>
                    {field.type === 'text' ? (
                      <input
                        id={fieldId}
                        type="text"
                        value={values[field.name] ?? ''}
                        placeholder={field.placeholder ?? ''}
                        disabled={inputsDisabled}
                        onChange={(event) => setField(field.name, event.target.value)}
                      />
                    ) : field.type === 'select' ? (
                      <select
                        id={fieldId}
                        value={values[field.name] ?? ''}
                        disabled={inputsDisabled}
                        onChange={(event) => setField(field.name, event.target.value)}
                      >
                        <option value="">请选择…</option>
                        {(field.options ?? []).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="ui-form-radio-group" role="radiogroup" aria-label={field.label}>
                        {(field.options ?? []).map((option) => (
                          <label key={option} className="ui-form-radio">
                            <input
                              type="radio"
                              name={fieldId}
                              value={option}
                              checked={values[field.name] === option}
                              disabled={inputsDisabled}
                              onChange={() => setField(field.name, option)}
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {invalid ? <span className="ui-form-error">此项必填</span> : null}
                  </div>
                );
              })}
            </div>

            <div className="ui-form-actions">
              <button type="submit" className="ui-form-submit" disabled={inputsDisabled}>
                {locked ? '已提交' : (spec.submitLabel ?? '提交')}
              </button>
              {disabled && !locked ? <span className="ui-form-hint">有会话正在执行，请稍候…</span> : null}
            </div>
          </form>
        </div>
      </div>
    </article>
  );
}
