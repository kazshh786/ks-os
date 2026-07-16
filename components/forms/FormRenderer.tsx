'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as Checkbox from '@radix-ui/react-checkbox';
import styles from './FormRenderer.module.css';

export type FormFieldType = 'text' | 'textarea' | 'checkbox' | 'signature' | 'select' | 'radio';
export type FormValue = string | boolean;

export interface FormField {
  id?: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  helpText?: string;
  placeholder?: string;
}

interface FormRendererProps {
  title: string;
  fields: FormField[];
  onSubmit?: (responses: Record<string, FormValue>) => void;
  preview?: boolean;
  submitLabel?: string;
}

function getFieldKey(field: FormField, index: number): string {
  return field.id || `legacy-field-${index}-${field.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function FormRenderer({
  title,
  fields,
  onSubmit,
  preview = false,
  submitLabel = 'Submit form',
}: FormRendererProps) {
  const [formData, setFormData] = useState<Record<string, FormValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const signatureFieldKeyRef = useRef<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    setFormData((current) => {
      const next: Record<string, FormValue> = {};

      fields.forEach((field, index) => {
        const key = getFieldKey(field, index);
        next[key] = current[key] ?? (field.type === 'checkbox' ? false : '');
      });

      return next;
    });
  }, [fields]);

  const handleInputChange = (key: string, value: FormValue) => {
    setFormData((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const getEventCoords = (
    event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement,
  ) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in event) {
      const touch = event.touches[0] || event.changedTouches[0];
      if (!touch) return { x: 0, y: 0 };
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (
    event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    fieldKey: string,
  ) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    signatureFieldKeyRef.current = fieldKey;
    context.strokeStyle = '#172033';
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    const coordinates = getEventCoords(event, canvas);
    context.beginPath();
    context.moveTo(coordinates.x, coordinates.y);
    setIsDrawing(true);
  };

  const draw = (event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const coordinates = getEventCoords(event, canvas);
    context.lineTo(coordinates.x, coordinates.y);
    context.stroke();
    setHasSignature(true);
  };

  const saveSignatureData = () => {
    const canvas = canvasRef.current;
    const fieldKey = signatureFieldKeyRef.current;
    if (!canvas || !fieldKey || !hasSignature) return;
    handleInputChange(fieldKey, canvas.toDataURL());
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    saveSignatureData();
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    if (signatureFieldKeyRef.current) {
      handleInputChange(signatureFieldKeyRef.current, '');
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (preview) return;

    const nextErrors: Record<string, string> = {};
    fields.forEach((field, index) => {
      if (!field.required) return;
      const key = getFieldKey(field, index);
      const value = formData[key];

      if (field.type === 'checkbox' && value !== true) {
        nextErrors[key] = 'Please confirm this agreement.';
      } else if (field.type === 'signature' && !value) {
        nextErrors[key] = 'Please add your signature.';
      } else if (!value || String(value).trim() === '') {
        nextErrors[key] = 'Please complete this field.';
      }
    });

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    onSubmit?.(formData);
  };

  return (
    <form className={styles.formContainer} onSubmit={handleSubmit} noValidate>
      <div className={styles.formHeader}>
        {preview && <span className={styles.previewBadge}>Customer preview</span>}
        <h3 className={styles.formTitle}>{title || 'Untitled form'}</h3>
        <p className={styles.formSubtitle}>Complete the details below before your appointment.</p>
      </div>

      {fields.length === 0 ? (
        <div className={styles.emptyPreview}>
          <span aria-hidden="true">＋</span>
          <strong>Your form preview will appear here</strong>
          <p>Add a field from the palette to get started.</p>
        </div>
      ) : (
        fields.map((field, index) => {
          const fieldKey = getFieldKey(field, index);
          const inputId = `form-field-${fieldKey}`;
          const errorId = `${inputId}-error`;
          const helpId = `${inputId}-help`;
          const hasError = Boolean(errors[fieldKey]);
          const describedBy = [field.helpText ? helpId : '', hasError ? errorId : ''].filter(Boolean).join(' ') || undefined;

          return (
            <div key={fieldKey} className={styles.fieldWrapper}>
              {field.type !== 'checkbox' && (
                <label className={styles.fieldLabel} htmlFor={inputId}>
                  {field.label || 'Untitled field'}
                  {field.required && <span className={styles.requiredAsterisk}> *</span>}
                </label>
              )}

              {field.helpText && (
                <p id={helpId} className={styles.helpText}>{field.helpText}</p>
              )}

              {field.type === 'text' && (
                <input
                  id={inputId}
                  type="text"
                  className={`${styles.textInput} ${hasError ? styles.inputErrorBorder : ''}`}
                  placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                  value={String(formData[fieldKey] || '')}
                  onChange={(event) => handleInputChange(fieldKey, event.target.value)}
                  aria-invalid={hasError}
                  aria-describedby={describedBy}
                />
              )}

              {field.type === 'textarea' && (
                <textarea
                  id={inputId}
                  className={`${styles.textareaInput} ${hasError ? styles.inputErrorBorder : ''}`}
                  placeholder={field.placeholder || 'Add any relevant details'}
                  rows={4}
                  value={String(formData[fieldKey] || '')}
                  onChange={(event) => handleInputChange(fieldKey, event.target.value)}
                  aria-invalid={hasError}
                  aria-describedby={describedBy}
                />
              )}

              {field.type === 'checkbox' && (
                <div className={styles.checkboxWrapper}>
                  <Checkbox.Root
                    className={styles.checkboxRoot}
                    checked={formData[fieldKey] === true}
                    onCheckedChange={(checked) => handleInputChange(fieldKey, checked === true)}
                    id={inputId}
                    aria-invalid={hasError}
                    aria-describedby={describedBy}
                  >
                    <Checkbox.Indicator className={styles.checkboxIndicator}>✓</Checkbox.Indicator>
                  </Checkbox.Root>
                  <label className={styles.checkboxLabel} htmlFor={inputId}>
                    {field.label || 'Untitled agreement'}
                    {field.required && <span className={styles.requiredAsterisk}> *</span>}
                  </label>
                </div>
              )}

              {field.type === 'select' && (
                <select
                  id={inputId}
                  className={`${styles.textInput} ${hasError ? styles.inputErrorBorder : ''}`}
                  value={String(formData[fieldKey] || '')}
                  onChange={(event) => handleInputChange(fieldKey, event.target.value)}
                  aria-invalid={hasError}
                  aria-describedby={describedBy}
                >
                  <option value="">Choose an option</option>
                  {(field.options || []).map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              )}

              {field.type === 'radio' && (
                <fieldset className={styles.choiceGroup} aria-describedby={describedBy}>
                  <legend className={styles.visuallyHidden}>{field.label}</legend>
                  {(field.options || []).map((option, optionIndex) => (
                    <label key={`${fieldKey}-${option}`} className={styles.choiceOption}>
                      <input
                        type="radio"
                        name={`radio-group-${fieldKey}`}
                        value={option}
                        checked={formData[fieldKey] === option}
                        onChange={(event) => handleInputChange(fieldKey, event.target.value)}
                        aria-invalid={hasError}
                        id={`${inputId}-${optionIndex}`}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </fieldset>
              )}

              {field.type === 'signature' && (
                <div className={styles.signaturePadWrapper}>
                  <div className={styles.canvasContainer}>
                    <canvas
                      id={inputId}
                      ref={canvasRef}
                      width={640}
                      height={240}
                      className={`${styles.signatureCanvas} ${hasError ? styles.inputErrorBorder : ''}`}
                      onMouseDown={(event) => startDrawing(event, fieldKey)}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={(event) => startDrawing(event, fieldKey)}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                      aria-label={`${field.label} signature area`}
                    />
                    {hasSignature && (
                      <button type="button" onClick={clearSignature} className={styles.clearSignButton}>
                        Clear signature
                      </button>
                    )}
                  </div>
                  <span className={styles.signatureHint}>Draw your signature using a mouse or finger.</span>
                </div>
              )}

              {hasError && (
                <p id={errorId} className={styles.errorMessageText} role="alert">{errors[fieldKey]}</p>
              )}
            </div>
          );
        })
      )}

      {!preview && fields.length > 0 && (
        <button type="submit" className={styles.submitButton}>{submitLabel}</button>
      )}
    </form>
  );
}

export default FormRenderer;
