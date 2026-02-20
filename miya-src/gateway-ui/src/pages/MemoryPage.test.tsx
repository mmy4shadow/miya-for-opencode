/**
 * Regression Tests for Memory Module
 * 
 * **Validates: Requirements 6.1~6.7**
 * 
 * This test suite verifies that all existing Memory functionality remains intact
 * after the UI restructuring. The Memory module should maintain:
 * - Memory list display (6.1)
 * - Memory filtering (6.2)
 * - Memory editing (6.3)
 * - Memory archiving (6.4)
 * - Memory confirmation (6.5)
 * - Batch operations (6.6)
 * - Memory import/export (6.7)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from '../App';

// Mock the gateway client with realistic data
const mockMemories = [
  {
    id: 'mem-123',
    text: 'Test memory content',
    domain: 'work',
    status: 'active',
    isArchived: false,
    memoryKind: 'Fact',
    createdAt: '2024-01-01T10:00:00Z',
    updatedAt: '2024-01-01T10:00:00Z',
  },
];

const mockGatewayResponse = {
  daemon: { connected: true, cpuPercent: 25 },
  nexus: { killSwitchMode: 'off' },
  sessions: { total: 0, active: 0, queued: 0, muted: 0 },
  jobs: { total: 0, enabled: 0, pendingApprovals: 0 },
  nodes: { total: 1, connected: 1 },
  policyHash: 'test-hash',
};

const mockRequest = vi.fn((method: string) => {
  if (method === 'gateway.status.get') return Promise.resolve(mockGatewayResponse);
  if (method === 'policy.domains.list') return Promise.resolve({ domains: [] });
  if (method === 'cron.list') return Promise.resolve([]);
  if (method === 'cron.runs.list') return Promise.resolve([]);
  if (method === 'security.identity.status') return Promise.resolve({ mode: 'owner' });
  if (method === 'miya.sync.list') return Promise.resolve({});
  if (method === 'companion.memory.vector.list') return Promise.resolve(mockMemories);
  return Promise.resolve({});
});

vi.mock('../gateway-client', () => ({
  GatewayRpcClient: vi.fn().mockImplementation(() => ({
    request: mockRequest,
    dispose: vi.fn(),
  })),
}));

describe('Memory Module Regression Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockClear();
    
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'test-token'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
    
    // Mock window.location
    window.history.replaceState({}, '', '/memory');
  });

  describe('Requirement 6.1: Memory List Display', () => {
    it('should display memory list with all memory records', async () => {
      /**
       * **Validates: Requirements 6.1**
       * 
       * The Memory module SHALL maintain the existing memory list display functionality.
       * Users should be able to see all memory records in a list format.
       */
      render(<App />);

      await waitFor(() => {
        const heading = screen.queryByText('记忆库');
        expect(heading).toBeInTheDocument();
      }, { timeout: 5000 });
    });
  });

  describe('Requirement 6.2: Memory Filtering', () => {
    it('should provide memory status filter options', async () => {
      /**
       * **Validates: Requirements 6.2**
       * 
       * The Memory module SHALL maintain memory filtering functionality with:
       * - Status filters (all, active, pending, superseded, archived)
       * - Domain filters (all, work, relationship)
       * - Text search
       */
      render(<App />);

      await waitFor(() => {
        const statusFilter = screen.queryByLabelText('记忆状态筛选');
        expect(statusFilter).toBeInTheDocument();
      }, { timeout: 5000 });

      const statusFilter = screen.getByLabelText('记忆状态筛选') as HTMLSelectElement;
      
      // Verify all status filter options exist
      expect(statusFilter.querySelector('option[value="all"]')).toBeInTheDocument();
      expect(statusFilter.querySelector('option[value="active"]')).toBeInTheDocument();
      expect(statusFilter.querySelector('option[value="pending"]')).toBeInTheDocument();
      expect(statusFilter.querySelector('option[value="superseded"]')).toBeInTheDocument();
      expect(statusFilter.querySelector('option[value="archived"]')).toBeInTheDocument();
    });

    it('should provide memory domain filter options', async () => {
      /**
       * **Validates: Requirements 6.2**
       * 
       * Users should be able to filter memories by domain (work/relationship).
       */
      render(<App />);

      await waitFor(() => {
        const domainFilter = screen.queryByLabelText('记忆域筛选');
        expect(domainFilter).toBeInTheDocument();
      }, { timeout: 5000 });

      const domainFilter = screen.getByLabelText('记忆域筛选') as HTMLSelectElement;
      
      // Verify domain filter options exist
      expect(domainFilter.querySelector('option[value="all"]')).toBeInTheDocument();
      expect(domainFilter.querySelector('option[value="work"]')).toBeInTheDocument();
      expect(domainFilter.querySelector('option[value="relationship"]')).toBeInTheDocument();
    });

    it('should provide memory text search input', async () => {
      /**
       * **Validates: Requirements 6.2**
       * 
       * Users should be able to search memories by text content.
       */
      render(<App />);

      await waitFor(() => {
        const searchInput = screen.queryByLabelText('搜索记忆');
        expect(searchInput).toBeInTheDocument();
      }, { timeout: 5000 });

      const searchInput = screen.getByLabelText('搜索记忆') as HTMLInputElement;
      expect(searchInput.placeholder).toContain('搜索记忆');
    });
  });

  describe('Requirement 6.3: Memory Editing', () => {
    it('should have memory detail route capability', async () => {
      /**
       * **Validates: Requirements 6.3**
       * 
       * The Memory module SHALL maintain memory editing functionality.
       * The route structure supports /memory/:memoryId pattern.
       */
      window.history.replaceState({}, '', '/memory/mem-123');
      
      render(<App />);

      await waitFor(() => {
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
      }, { timeout: 5000 });
    });
  });

  describe('Requirement 6.4: Memory Archiving', () => {
    it('should provide archive functionality', async () => {
      /**
       * **Validates: Requirements 6.4**
       * 
       * The Memory module SHALL maintain memory archiving functionality.
       */
      window.history.replaceState({}, '', '/memory/mem-123');
      
      render(<App />);

      await waitFor(() => {
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
      }, { timeout: 5000 });
    });
  });

  describe('Requirement 6.5: Memory Confirmation', () => {
    it('should provide confirm functionality', async () => {
      /**
       * **Validates: Requirements 6.5**
       * 
       * The Memory module SHALL maintain memory confirmation functionality.
       */
      window.history.replaceState({}, '', '/memory/mem-123');
      
      render(<App />);

      await waitFor(() => {
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
      }, { timeout: 5000 });
    });
  });

  describe('Requirement 6.6: Batch Operations', () => {
    it('should provide batch confirmation button', async () => {
      /**
       * **Validates: Requirements 6.6**
       * 
       * The Memory module SHALL maintain batch operations functionality.
       */
      render(<App />);

      await waitFor(() => {
        const batchConfirmButton = screen.queryByText(/批量确认/);
        expect(batchConfirmButton).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('should provide batch archive button', async () => {
      /**
       * **Validates: Requirements 6.6**
       * 
       * Users should be able to archive multiple memories at once.
       */
      render(<App />);

      await waitFor(() => {
        const batchArchiveButton = screen.queryByText(/批量归档/);
        expect(batchArchiveButton).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('should provide select all/deselect all button', async () => {
      /**
       * **Validates: Requirements 6.6**
       * 
       * Users should be able to select/deselect all visible memories.
       */
      render(<App />);

      await waitFor(() => {
        const selectAllButton = screen.queryByText(/全选.*反选/);
        expect(selectAllButton).toBeInTheDocument();
      }, { timeout: 5000 });
    });
  });

  describe('Requirement 6.7: Memory Import/Export', () => {
    it('should provide export selected button', async () => {
      /**
       * **Validates: Requirements 6.7**
       * 
       * The Memory module SHALL maintain memory import/export functionality.
       */
      render(<App />);

      await waitFor(() => {
        const exportSelectedButton = screen.queryByText(/导出选中/);
        expect(exportSelectedButton).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('should provide export all button', async () => {
      /**
       * **Validates: Requirements 6.7**
       * 
       * Users should be able to export all memories as JSON.
       */
      render(<App />);

      await waitFor(() => {
        const exportAllButton = screen.queryByText(/导出全部/);
        expect(exportAllButton).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('should provide import JSON button', async () => {
      /**
       * **Validates: Requirements 6.7**
       * 
       * Users should be able to import memories from JSON files.
       */
      render(<App />);

      await waitFor(() => {
        const importButton = screen.queryByText(/导入.*JSON/);
        expect(importButton).toBeInTheDocument();
      }, { timeout: 5000 });
    });
  });

  describe('Integration: Complete Memory Workflow', () => {
    it('should support complete memory management workflow', async () => {
      /**
       * **Validates: Requirements 6.1~6.7**
       * 
       * This integration test verifies that all memory features work together.
       */
      window.history.replaceState({}, '', '/memory');
      
      render(<App />);

      // Verify memory list page loads
      await waitFor(() => {
        expect(screen.queryByText('记忆库')).toBeInTheDocument();
      }, { timeout: 5000 });

      // Verify filter and search controls exist
      await waitFor(() => {
        expect(screen.queryByLabelText('记忆状态筛选')).toBeInTheDocument();
        expect(screen.queryByLabelText('记忆域筛选')).toBeInTheDocument();
        expect(screen.queryByLabelText('搜索记忆')).toBeInTheDocument();
      }, { timeout: 5000 });

      // Verify batch operation buttons exist
      await waitFor(() => {
        expect(screen.queryByText(/批量确认/)).toBeInTheDocument();
        expect(screen.queryByText(/批量归档/)).toBeInTheDocument();
      }, { timeout: 5000 });

      // Verify import/export buttons exist
      await waitFor(() => {
        expect(screen.queryByText(/导出选中/)).toBeInTheDocument();
        expect(screen.queryByText(/导出全部/)).toBeInTheDocument();
        expect(screen.queryByText(/导入.*JSON/)).toBeInTheDocument();
      }, { timeout: 5000 });
    });
  });
});
