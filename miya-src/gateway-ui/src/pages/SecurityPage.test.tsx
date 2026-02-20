screen.getByText('权限范围控制')).toBeInTheDocument();
  });

  it('should render trust mode configuration card (Requirement 4.5)', () => {
    render(<SecurityPage />);
    
    expect(screen.getByText('信任模式配置')).toBeInTheDocument();
    expect(screen.getByText('静默与模态阈值')).toBeInTheDocument();
  });

  it('should display trust mode values (Requirement 4.5)', () => {
    render(<SecurityPage />);
    
    expect(screen.getByDisplayValue('70')).toBeInTheDocument(); // silentMin
    expect(screen.getByDisplayValue('30')).toBeInTheDocument(); // modalMax
  });

  it('should render session permission card (Requirement 4.11)', () => {
    render(<SecurityPage />);
    
    expect(screen.getByText('会话权限')).toBeInTheDocument();
    expect(screen.getByText('当前会话信息')).toBeInTheDocument();
    expect(screen.getByText('test-tool')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('should render evidence pack list (Requirement 4.7)', () => {
    render(<SecurityPage />);
    
    expect(screen.getByText('最近执行序列')).toBeInTheDocument();
    expect(screen.getByText('Evidence Pack V5 预览')).toBeInTheDocument();
  });

  it('should display evidence pack items (Requirement 4.8)', () => {
    render(<SecurityPage />);
    
    expect(screen.getByText(/email → user@example\.com/i)).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText(/置信度: 95%/i)).toBeInTheDocument();
  });

  it('should show screenshot buttons when available (Requirement 4.9)', () => {
    render(<SecurityPage />);
    
    expect(screen.getByText('查看前置截图')).toBeInTheDocument();
    expect(screen.getByText('查看后置截图')).toBeInTheDocument();
  });

  it('should show loading state when data is not available', () => {
    vi.mocked(useGatewayModule.useGateway).mockReturnValue({
      snapshot: null as any,
      loading: true,
      connected: false,
      refresh: vi.fn(),
      setKillSwitch: vi.fn(),
    });
    
    render(<SecurityPage />);
    
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('should display empty state when no evidence packs exist', () => {
    const snapshotWithoutEvidence = {
      ...mockSnapshot,
      channels: {
        ...mockSnapshot.channels,
        recentOutbound: [],
      },
    };
    
    vi.mocked(useGatewayModule.useGateway).mockReturnValue({
      snapshot: snapshotWithoutEvidence,
      loading: false,
      connected: true,
      refresh: vi.fn(),
      setKillSwitch: mockSetKillSwitch,
    });
    
    render(<SecurityPage />);
    
    expect(screen.getByText('暂无执行记录')).toBeInTheDocument();
  });

  it('should display empty state when no policy domains exist', () => {
    render(<SecurityPage />);
    
    expect(screen.getByText('暂无策略域')).toBeInTheDocument();
  });
});
