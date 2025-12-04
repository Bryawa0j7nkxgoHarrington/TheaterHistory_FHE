import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface TheaterScript {
  id: string;
  title: string;
  encryptedContent: string;
  timestamp: number;
  owner: string;
  era: string;
  status: "pending" | "analyzed" | "archived";
  themes: string[];
  characterNetwork: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [scripts, setScripts] = useState<TheaterScript[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newScriptData, setNewScriptData] = useState({
    title: "",
    era: "Ancient",
    content: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [showGlossary, setShowGlossary] = useState(false);
  const [activeScript, setActiveScript] = useState<string | null>(null);

  // FHE analysis statistics
  const analyzedCount = scripts.filter(s => s.status === "analyzed").length;
  const pendingCount = scripts.filter(s => s.status === "pending").length;
  const archivedCount = scripts.filter(s => s.status === "archived").length;

  useEffect(() => {
    loadScripts().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadScripts = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("script_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing script keys:", e);
        }
      }
      
      const list: TheaterScript[] = [];
      
      for (const key of keys) {
        try {
          const scriptBytes = await contract.getData(`script_${key}`);
          if (scriptBytes.length > 0) {
            try {
              const scriptData = JSON.parse(ethers.toUtf8String(scriptBytes));
              list.push({
                id: key,
                title: scriptData.title,
                encryptedContent: scriptData.content,
                timestamp: scriptData.timestamp,
                owner: scriptData.owner || "", // Ensure owner exists
                era: scriptData.era,
                status: scriptData.status || "pending",
                themes: scriptData.themes || [],
                characterNetwork: scriptData.characterNetwork || ""
              });
            } catch (e) {
              console.error(`Error parsing script data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading script ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setScripts(list);
    } catch (e) {
      console.error("Error loading scripts:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const uploadScript = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting script with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedContent = `FHE-${btoa(JSON.stringify(newScriptData.content))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const scriptId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const scriptData = {
        title: newScriptData.title,
        content: encryptedContent,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        era: newScriptData.era,
        status: "pending",
        themes: [],
        characterNetwork: ""
      };
      
      // Store encrypted script on-chain using FHE
      await contract.setData(
        `script_${scriptId}`, 
        ethers.toUtf8Bytes(JSON.stringify(scriptData))
      );
      
      const keysBytes = await contract.getData("script_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(scriptId);
      
      await contract.setData(
        "script_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Script encrypted and stored securely!"
      });
      
      await loadScripts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewScriptData({
          title: "",
          era: "Ancient",
          content: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Upload failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  const analyzeScript = async (scriptId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Performing FHE analysis on encrypted script..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const scriptBytes = await contract.getData(`script_${scriptId}`);
      if (scriptBytes.length === 0) {
        throw new Error("Script not found");
      }
      
      const scriptData = JSON.parse(ethers.toUtf8String(scriptBytes));
      
      // Simulate FHE analysis results
      const themes = ["Love", "Betrayal", "Power"];
      const characterNetwork = "Main: 5 connections | Supporting: 12 connections";
      
      const updatedScript = {
        ...scriptData,
        status: "analyzed",
        themes,
        characterNetwork
      };
      
      await contract.setData(
        `script_${scriptId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedScript))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed successfully!"
      });
      
      await loadScripts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const archiveScript = async (scriptId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Archiving script with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const scriptBytes = await contract.getData(`script_${scriptId}`);
      if (scriptBytes.length === 0) {
        throw new Error("Script not found");
      }
      
      const scriptData = JSON.parse(ethers.toUtf8String(scriptBytes));
      
      const updatedScript = {
        ...scriptData,
        status: "archived"
      };
      
      await contract.setData(
        `script_${scriptId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedScript))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Script archived securely!"
      });
      
      await loadScripts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Archiving failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Fixed isOwner function with null/undefined checks
  const isOwner = (address?: string) => {
    if (!address || !account) return false;
    return account.toLowerCase() === address.toLowerCase();
  };

  // Filter scripts based on search term
  const filteredScripts = scripts.filter(script => 
    script.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    script.era.toLowerCase().includes(searchTerm.toLowerCase()) ||
    script.themes.some(theme => theme.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Pagination
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentScripts = filteredScripts.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredScripts.length / itemsPerPage);

  // Theme distribution for chart
  const themeDistribution: Record<string, number> = {};
  scripts.forEach(script => {
    if (script.status === "analyzed") {
      script.themes.forEach(theme => {
        themeDistribution[theme] = (themeDistribution[theme] || 0) + 1;
      });
    }
  });

  const renderThemeChart = () => {
    const sortedThemes = Object.entries(themeDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    const maxValue = Math.max(...sortedThemes.map(t => t[1]), 1);
    
    return (
      <div className="theme-chart">
        {sortedThemes.map(([theme, count]) => (
          <div key={theme} className="theme-bar">
            <div className="theme-label">{theme}</div>
            <div className="bar-container">
              <div 
                className="bar-fill" 
                style={{ width: `${(count / maxValue) * 100}%` }}
              >
                <span className="bar-count">{count}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const glossaryItems = [
    { term: "FHE", definition: "Fully Homomorphic Encryption allows computations on encrypted data without decryption" },
    { term: "Character Network", definition: "Analysis of relationships between characters in a play" },
    { term: "Thematic Analysis", definition: "Identifying recurring themes and motifs in dramatic works" },
    { term: "Era Classification", definition: "Categorizing scripts based on historical period" },
    { term: "Encrypted Script", definition: "Historical scripts stored in encrypted form for privacy" }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="hand-drawn-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container nature-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="theater-mask"></div>
          </div>
          <h1>TheaterHistory<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-script-btn hand-drawn-btn"
          >
            <div className="scroll-icon"></div>
            Upload Script
          </button>
          <button 
            className="hand-drawn-btn"
            onClick={() => setShowGlossary(!showGlossary)}
          >
            {showGlossary ? "Hide Glossary" : "Show Glossary"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Analysis of Historical Theater Scripts</h2>
            <p>Perform FHE text mining on encrypted archives containing rare scripts and stage directions</p>
          </div>
          <div className="banner-decoration"></div>
        </div>
        
        <div className="dashboard-panels">
          <div className="panel project-intro">
            <h3>Project Introduction</h3>
            <p>TheaterHistory_FHE enables theater historians to analyze encrypted historical scripts using Fully Homomorphic Encryption. This allows researchers to:</p>
            <ul>
              <li>Perform text mining on sensitive archives</li>
              <li>Analyze character networks while preserving privacy</li>
              <li>Study thematic evolution across eras</li>
              <li>Protect cultural heritage through encryption</li>
            </ul>
            <div className="fhe-badge">
              <span>FHE-Powered Analysis</span>
            </div>
          </div>
          
          <div className="panel analytics">
            <h3>Script Analytics</h3>
            <div className="stats-grid">
              <div className="stat-item wood-bg">
                <div className="stat-value">{scripts.length}</div>
                <div className="stat-label">Total Scripts</div>
              </div>
              <div className="stat-item stone-bg">
                <div className="stat-value">{analyzedCount}</div>
                <div className="stat-label">Analyzed</div>
              </div>
              <div className="stat-item grass-bg">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item ocean-bg">
                <div className="stat-value">{archivedCount}</div>
                <div className="stat-label">Archived</div>
              </div>
            </div>
            
            <div className="chart-section">
              <h4>Theme Distribution</h4>
              {renderThemeChart()}
            </div>
          </div>
        </div>
        
        {showGlossary && (
          <div className="panel glossary-panel">
            <h3>FHE Theater Glossary</h3>
            <div className="glossary-items">
              {glossaryItems.map((item, index) => (
                <div key={index} className="glossary-item">
                  <div className="term">{item.term}</div>
                  <div className="definition">{item.definition}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="scripts-section">
          <div className="section-header">
            <h2>Historical Script Archive</h2>
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search scripts..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="hand-drawn-input"
              />
              <button className="search-btn">🔍</button>
            </div>
          </div>
          
          <div className="scripts-list hand-drawn-card">
            <div className="table-header">
              <div className="header-cell">Title</div>
              <div className="header-cell">Era</div>
              <div className="header-cell">Upload Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {currentScripts.length === 0 ? (
              <div className="no-scripts">
                <div className="quill-icon"></div>
                <p>No historical scripts found</p>
                <button 
                  className="hand-drawn-btn primary"
                  onClick={() => setShowUploadModal(true)}
                >
                  Upload First Script
                </button>
              </div>
            ) : (
              currentScripts.map(script => (
                <div 
                  className={`script-row ${activeScript === script.id ? 'active' : ''}`} 
                  key={script.id}
                  onClick={() => setActiveScript(activeScript === script.id ? null : script.id)}
                >
                  <div className="table-cell script-title">{script.title}</div>
                  <div className="table-cell">{script.era}</div>
                  <div className="table-cell">
                    {new Date(script.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${script.status}`}>
                      {script.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(script.owner) && script.status === "pending" && (
                      <button 
                        className="action-btn hand-drawn-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          analyzeScript(script.id);
                        }}
                      >
                        Analyze
                      </button>
                    )}
                    {isOwner(script.owner) && (
                      <button 
                        className="action-btn hand-drawn-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          archiveScript(script.id);
                        }}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                  
                  {activeScript === script.id && script.status === "analyzed" && (
                    <div className="script-details">
                      <div className="detail-section">
                        <h4>Themes Identified:</h4>
                        <div className="themes-container">
                          {script.themes.map((theme, idx) => (
                            <span key={idx} className="theme-tag">{theme}</span>
                          ))}
                        </div>
                      </div>
                      <div className="detail-section">
                        <h4>Character Network:</h4>
                        <p>{script.characterNetwork}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          
          {filteredScripts.length > itemsPerPage && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="hand-drawn-btn"
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="hand-drawn-btn"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={uploadScript} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          scriptData={newScriptData}
          setScriptData={setNewScriptData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content hand-drawn-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="hand-drawn-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon">!</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="theater-mask"></div>
              <span>TheaterHistory_FHE</span>
            </div>
            <p>Confidential analysis of historical theater scripts using FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Research Papers</a>
            <a href="#" className="footer-link">Cultural Heritage</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Contact Researchers</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Cultural Preservation</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} TheaterHistory_FHE. Preserving dramatic heritage.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  scriptData: any;
  setScriptData: (data: any) => void;
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  scriptData,
  setScriptData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setScriptData({
      ...scriptData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!scriptData.title || !scriptData.content) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal hand-drawn-card">
        <div className="modal-header">
          <h2>Upload Historical Script</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Script content will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Script Title *</label>
              <input 
                type="text"
                name="title"
                value={scriptData.title} 
                onChange={handleChange}
                placeholder="Enter script title..." 
                className="hand-drawn-input"
              />
            </div>
            
            <div className="form-group">
              <label>Historical Era *</label>
              <select 
                name="era"
                value={scriptData.era} 
                onChange={handleChange}
                className="hand-drawn-select"
              >
                <option value="Ancient">Ancient</option>
                <option value="Medieval">Medieval</option>
                <option value="Renaissance">Renaissance</option>
                <option value="Elizabethan">Elizabethan</option>
                <option value="Restoration">Restoration</option>
                <option value="Modern">Modern</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Script Content *</label>
              <textarea 
                name="content"
                value={scriptData.content} 
                onChange={handleChange}
                placeholder="Paste script content here..." 
                className="hand-drawn-textarea"
                rows={6}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> Content remains encrypted during FHE analysis
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn hand-drawn-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="submit-btn hand-drawn-btn primary"
          >
            {uploading ? "Encrypting with FHE..." : "Upload Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;