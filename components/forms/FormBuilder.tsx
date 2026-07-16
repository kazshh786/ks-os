'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { FormField, FormFieldType, FormRenderer } from './FormRenderer';
import styles from './FormBuilder.module.css';

interface FormBuilderProps {
  title: string;
  fields: FormField[];
  onTitleChange: (title: string) => void;
  onFieldsChange: (fields: FormField[]) => void;
  onSave: () => void | Promise<void>;
  isSaving?: boolean;
  isPublished?: boolean;
}

interface FieldTypeDefinition {
  type: FormFieldType;
  label: string;
  description: string;
  icon: string;
}

const FIELD_TYPES: FieldTypeDefinition[] = [
  { type: 'text', label: 'Short answer', description: 'Names, phone numbers, IDs', icon: 'T' },
  { type: 'textarea', label: 'Long answer', description: 'Notes and medical details', icon: '¶' },
  { type: 'radio', label: 'Single choice', description: 'Choose one option', icon: '◉' },
  { type: 'select', label: 'Dropdown', description: 'Compact single choice', icon: '⌄' },
  { type: 'checkbox', label: 'Agreement', description: 'Consent or confirmation', icon: '✓' },
  { type: 'signature', label: 'Signature', description: 'Drawn customer signature', icon: '✎' },
];

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `field-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDefaultField(type: FormFieldType): FormField {
  const shared = { id: createId(), required: false };

  switch (type) {
    case 'textarea':
      return { ...shared, type, label: 'Please provide more details', placeholder: 'Add relevant information' };
    case 'radio':
      return { ...shared, type, label: 'Choose one option', options: ['Yes', 'No'] };
    case 'select':
      return { ...shared, type, label: 'Select an option', options: ['Option 1', 'Option 2'] };
    case 'checkbox':
      return { ...shared, type, label: 'I confirm that the information provided is accurate', required: true };
    case 'signature':
      return { ...shared, type, label: 'Customer signature', required: true };
    default:
      return { ...shared, type: 'text', label: 'Short answer', placeholder: 'Type your answer' };
  }
}

export function FormBuilder({
  title,
  fields,
  onTitleChange,
  onFieldsChange,
  onSave,
  isSaving = false,
  isPublished = false,
}: FormBuilderProps) {
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(fields[0]?.id || null);
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null);

  useEffect(() => {
    if (fields.some((field) => !field.id)) {
      onFieldsChange(fields.map((field) => ({ ...field, id: field.id || createId() })));
    }
  }, [fields, onFieldsChange]);

  useEffect(() => {
    if (selectedFieldId && fields.some((field) => field.id === selectedFieldId)) return;
    setSelectedFieldId(fields[0]?.id || null);
  }, [fields, selectedFieldId]);

  const selectedField = useMemo(
    () => fields.find((field) => field.id === selectedFieldId) || null,
    [fields, selectedFieldId],
  );

  const addField = (type: FormFieldType) => {
    const field = getDefaultField(type);
    onFieldsChange([...fields, field]);
    setSelectedFieldId(field.id || null);
  };

  const updateSelectedField = (patch: Partial<FormField>) => {
    if (!selectedFieldId) return;
    onFieldsChange(fields.map((field) => (
      field.id === selectedFieldId ? { ...field, ...patch } : field
    )));
  };

  const deleteField = (fieldId: string) => {
    const fieldIndex = fields.findIndex((field) => field.id === fieldId);
    const nextFields = fields.filter((field) => field.id !== fieldId);
    onFieldsChange(nextFields);
    setSelectedFieldId(nextFields[Math.max(0, fieldIndex - 1)]?.id || null);
  };

  const moveField = (fieldId: string, direction: -1 | 1) => {
    const fromIndex = fields.findIndex((field) => field.id === fieldId);
    const toIndex = fromIndex + direction;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= fields.length) return;

    const nextFields = [...fields];
    const [movedField] = nextFields.splice(fromIndex, 1);
    nextFields.splice(toIndex, 0, movedField);
    onFieldsChange(nextFields);
  };

  const dropField = (targetFieldId: string) => {
    if (!draggedFieldId || draggedFieldId === targetFieldId) return;
    const fromIndex = fields.findIndex((field) => field.id === draggedFieldId);
    const toIndex = fields.findIndex((field) => field.id === targetFieldId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextFields = [...fields];
    const [movedField] = nextFields.splice(fromIndex, 1);
    nextFields.splice(toIndex, 0, movedField);
    onFieldsChange(nextFields);
    setDraggedFieldId(null);
  };

  const updateOptions = (value: string) => {
    const options = value.split('\n').map((option) => option.trim()).filter(Boolean);
    updateSelectedField({ options });
  };

  return (
    <section className={styles.builderShell} aria-labelledby="form-builder-title">
      <div className={styles.builderHeader}>
        <div>
          <div className={styles.eyebrowRow}>
            <span className={`${styles.statusBadge} ${isPublished ? styles.statusPublished : ''}`}>
              {isPublished ? 'Published' : 'Draft'}
            </span>
            <span>{fields.length} {fields.length === 1 ? 'field' : 'fields'}</span>
          </div>
          <h3 id="form-builder-title">Intake form builder</h3>
          <p>Build the form and check the customer experience at the same time.</p>
        </div>
        <button type="button" className={styles.publishButton} onClick={onSave} disabled={isSaving || !title.trim()}>
          {isSaving ? 'Publishing…' : isPublished ? 'Update form' : 'Publish form'}
        </button>
      </div>

      <div className={styles.titleField}>
        <label htmlFor="builder-form-title">Form name</label>
        <input
          id="builder-form-title"
          type="text"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="e.g. New client consultation"
        />
      </div>

      <div className={styles.builderGrid}>
        <div className={styles.buildColumn}>
          <section className={styles.palettePanel} aria-labelledby="field-palette-title">
            <div className={styles.panelHeading}>
              <div>
                <span className={styles.stepNumber}>1</span>
                <h4 id="field-palette-title">Add a field</h4>
              </div>
              <p>Choose the answer format your customer needs.</p>
            </div>
            <div className={styles.fieldPalette}>
              {FIELD_TYPES.map((definition) => (
                <button
                  type="button"
                  key={definition.type}
                  className={styles.paletteButton}
                  onClick={() => addField(definition.type)}
                >
                  <span className={styles.paletteIcon} aria-hidden="true">{definition.icon}</span>
                  <span>
                    <strong>{definition.label}</strong>
                    <small>{definition.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.fieldsPanel} aria-labelledby="form-fields-title">
            <div className={styles.panelHeading}>
              <div>
                <span className={styles.stepNumber}>2</span>
                <h4 id="form-fields-title">Arrange and edit</h4>
              </div>
              <p>Drag fields or use the arrow buttons to change their order.</p>
            </div>

            {fields.length === 0 ? (
              <div className={styles.emptyFields}>
                <strong>No fields yet</strong>
                <span>Add your first field from the palette above.</span>
              </div>
            ) : (
              <ol className={styles.fieldList}>
                {fields.map((field, index) => {
                  const definition = FIELD_TYPES.find((item) => item.type === field.type);
                  const isSelected = field.id === selectedFieldId;
                  return (
                    <li
                      key={field.id}
                      className={`${styles.fieldItem} ${isSelected ? styles.fieldItemSelected : ''}`}
                      draggable
                      onDragStart={() => setDraggedFieldId(field.id || null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => field.id && dropField(field.id)}
                    >
                      <button
                        type="button"
                        className={styles.fieldSelectButton}
                        onClick={() => setSelectedFieldId(field.id || null)}
                        aria-pressed={isSelected}
                      >
                        <span className={styles.dragHandle} aria-hidden="true">⋮⋮</span>
                        <span className={styles.fieldTypeIcon} aria-hidden="true">{definition?.icon || 'T'}</span>
                        <span className={styles.fieldItemText}>
                          <strong>{field.label || 'Untitled field'}</strong>
                          <small>{definition?.label}{field.required ? ' · Required' : ''}</small>
                        </span>
                      </button>
                      <div className={styles.fieldActions}>
                        <button type="button" onClick={() => field.id && moveField(field.id, -1)} disabled={index === 0} aria-label={`Move ${field.label} up`}>↑</button>
                        <button type="button" onClick={() => field.id && moveField(field.id, 1)} disabled={index === fields.length - 1} aria-label={`Move ${field.label} down`}>↓</button>
                        <button type="button" className={styles.deleteButton} onClick={() => field.id && deleteField(field.id)} aria-label={`Delete ${field.label}`}>×</button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {selectedField && (
              <div className={styles.fieldSettings}>
                <div className={styles.settingsHeader}>
                  <strong>Field settings</strong>
                  <span>Changes appear in the preview immediately.</span>
                </div>
                <div className={styles.settingsGrid}>
                  <div className={styles.inputGroupWide}>
                    <label htmlFor="field-label">Question or label</label>
                    <input
                      id="field-label"
                      type="text"
                      value={selectedField.label}
                      onChange={(event) => updateSelectedField({ label: event.target.value })}
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label htmlFor="field-type">Answer type</label>
                    <select
                      id="field-type"
                      value={selectedField.type}
                      onChange={(event) => {
                        const type = event.target.value as FormFieldType;
                        const patch: Partial<FormField> = { type };
                        if ((type === 'radio' || type === 'select') && !selectedField.options?.length) {
                          patch.options = ['Yes', 'No'];
                        }
                        updateSelectedField(patch);
                      }}
                    >
                      {FIELD_TYPES.map((definition) => (
                        <option key={definition.type} value={definition.type}>{definition.label}</option>
                      ))}
                    </select>
                  </div>
                  <label className={styles.requiredControl}>
                    <input
                      type="checkbox"
                      checked={selectedField.required}
                      onChange={(event) => updateSelectedField({ required: event.target.checked })}
                    />
                    <span>
                      <strong>Required</strong>
                      <small>Customers must answer before submitting.</small>
                    </span>
                  </label>
                  {(selectedField.type === 'text' || selectedField.type === 'textarea') && (
                    <div className={styles.inputGroupWide}>
                      <label htmlFor="field-placeholder">Example or placeholder</label>
                      <input
                        id="field-placeholder"
                        type="text"
                        value={selectedField.placeholder || ''}
                        onChange={(event) => updateSelectedField({ placeholder: event.target.value })}
                        placeholder="Show customers what to enter"
                      />
                    </div>
                  )}
                  {(selectedField.type === 'radio' || selectedField.type === 'select') && (
                    <div className={styles.inputGroupWide}>
                      <label htmlFor="field-options">Answer options</label>
                      <textarea
                        id="field-options"
                        rows={4}
                        value={(selectedField.options || []).join('\n')}
                        onChange={(event) => updateOptions(event.target.value)}
                        placeholder={'One option per line\nYes\nNo'}
                      />
                      <small>Enter one option per line.</small>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className={styles.previewColumn} aria-label="Live customer form preview">
          <div className={styles.previewHeading}>
            <div>
              <span className={styles.stepNumber}>3</span>
              <strong>Customer preview</strong>
            </div>
            <span className={styles.livePill}><i /> Live</span>
          </div>
          <div className={styles.previewCanvas}>
            <FormRenderer title={title} fields={fields} preview />
          </div>
        </aside>
      </div>
    </section>
  );
}

export default FormBuilder;
