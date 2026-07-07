'use client';

import React, { useState, useRef, useEffect } from 'react';
import * as Checkbox from '@radix-ui/react-checkbox';
import styles from './FormRenderer.module.css';

export interface FormField {
  label: string;
  type: 'text' | 'textarea' | 'checkbox' | 'signature';
  required: boolean;
}

interface FormRendererProps {
  title: string;
  fields: FormField[];
  onSubmit: (responses: Record<string, any>) => void;
}

export default function FormRenderer({ title, fields, onSubmit }: FormRendererProps) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  // Initialize form fields state
  useEffect(() => {
    const initialData: Record<string, any> = {};
    fields.forEach((field) => {
      if (field.type === 'checkbox') {
        initialData[field.label] = false;
      } else {
        initialData[field.label] = '';
      }
    });
    setFormData(initialData);
  }, [fields]);

  const handleInputChange = (label: string, value: any) => {
    setFormData((prev) => ({ ...prev, [label]: value }));
    if (errors[label]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[label];
        return next;
      });
    }
  };

  // Canvas Signature Pad Operations
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';

    const coords = getEventCoords(e, canvas);
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const coords = getEventCoords(e, canvas);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    saveSignatureData();
  };

  const getEventCoords = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) => {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);

    // Remove signature from data payload
    const signatureField = fields.find((f) => f.type === 'signature');
    if (signatureField) {
      handleInputChange(signatureField.label, '');
    }
  };

  const saveSignatureData = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;

    // Convert Canvas Drawing to Base64 PNG URL
    const signatureDataUrl = canvas.toDataURL();
    const signatureField = fields.find((f) => f.type === 'signature');
    if (signatureField) {
      handleInputChange(signatureField.label, signatureDataUrl);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    // Validate fields
    fields.forEach((field) => {
      const val = formData[field.label];
      if (field.required) {
        if (field.type === 'checkbox' && !val) {
          newErrors[field.label] = 'This agreement must be checked.';
        } else if (field.type === 'signature' && !hasSignature) {
          newErrors[field.label] = 'Your signature is required.';
        } else if (!val || String(val).trim() === '') {
          newErrors[field.label] = 'This field is required.';
        }
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSubmit(formData);
  };

  return (
    <form className={styles.formContainer} onSubmit={handleSubmit}>
      <h3 className={styles.formTitle}>{title}</h3>
      <p className={styles.formSubtitle}>Please complete the following details before your session.</p>

      {fields.map((field, idx) => {
        const hasError = !!errors[field.label];

        return (
          <div key={idx} className={styles.fieldWrapper}>
            {field.type !== 'checkbox' && (
              <label className={styles.fieldLabel}>
                {field.label} {field.required && <span className={styles.requiredAsterisk}>*</span>}
              </label>
            )}

            {/* Render based on field type */}
            {field.type === 'text' && (
              <input
                type="text"
                className={`${styles.textInput} ${hasError ? styles.inputErrorBorder : ''}`}
                placeholder={`Enter ${field.label.toLowerCase()}`}
                value={formData[field.label] || ''}
                onChange={(e) => handleInputChange(field.label, e.target.value)}
              />
            )}

            {field.type === 'textarea' && (
              <textarea
                className={`${styles.textareaInput} ${hasError ? styles.inputErrorBorder : ''}`}
                placeholder={`Describe any details...`}
                rows={4}
                value={formData[field.label] || ''}
                onChange={(e) => handleInputChange(field.label, e.target.value)}
              />
            )}

            {field.type === 'checkbox' && (
              <div className={styles.checkboxWrapper}>
                <Checkbox.Root
                  className={styles.checkboxRoot}
                  checked={!!formData[field.label]}
                  onCheckedChange={(checked) => handleInputChange(field.label, checked === true)}
                  id={`field-${idx}`}
                >
                  <Checkbox.Indicator className={styles.checkboxIndicator}>
                    ✓
                  </Checkbox.Indicator>
                </Checkbox.Root>
                <label className={styles.checkboxLabel} htmlFor={`field-${idx}`}>
                  {field.label} {field.required && <span className={styles.requiredAsterisk}>*</span>}
                </label>
              </div>
            )}

            {field.type === 'signature' && (
              <div className={styles.signaturePadWrapper}>
                <div className={styles.canvasContainer}>
                  <canvas
                    ref={canvasRef}
                    width={350}
                    height={150}
                    className={`${styles.signatureCanvas} ${hasError ? styles.inputErrorBorder : ''}`}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                  />
                  <button
                    type="button"
                    className={styles.clearSignButton}
                    onClick={clearSignature}
                  >
                    Clear Signature
                  </button>
                </div>
              </div>
            )}

            {hasError && <span className={styles.errorMessageText}>{errors[field.label]}</span>}
          </div>
        );
      })}

      <button type="submit" className={styles.submitButton}>
        Submit Compliance Intake
      </button>
    </form>
  );
}
