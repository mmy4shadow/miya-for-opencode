import { describe, expect, it } from 'vitest';

describe('Test Setup', () => {
  it('should run basic tests', () => {
    expect(true).toBe(true);
  });

  it('should have jest-dom matchers available', () => {
    const element = document.createElement('div');
    element.textContent = 'Hello World';
    document.body.appendChild(element);
    expect(element).toBeInTheDocument();
    document.body.removeChild(element);
  });
});
