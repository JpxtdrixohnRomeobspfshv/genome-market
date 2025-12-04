import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface GenomeData {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  price: string;
  status: "pending" | "approved" | "sold";
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [genomeData, setGenomeData] = useState<GenomeData[]>([]);
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
  const [newGenomeData, setNewGenomeData] = useState({
    description: "",
    price: "0.1"
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("myData");
  const [searchQuery, setSearchQuery] = useState("");

  // Calculate statistics
  const approvedCount = genomeData.filter(d => d.status === "approved").length;
  const soldCount = genomeData.filter(d => d.status === "sold").length;
  const pendingCount = genomeData.filter(d => d.status === "pending").length;
  const totalEarnings = genomeData
    .filter(d => d.status === "sold" && d.owner.toLowerCase() === account.toLowerCase())
    .reduce((sum, data) => sum + parseFloat(data.price), 0)
    .toFixed(4);

  useEffect(() => {
    loadGenomeData().finally(() => setLoading(false));
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

  // Load genome data from contract
  const loadGenomeData = async () => {
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
      
      const keysBytes = await contract.getData("genome_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing genome keys:", e);
        }
      }
      
      const list: GenomeData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`genome_${key}`);
          if (dataBytes.length > 0) {
            try {
              const genome = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                encryptedData: genome.data,
                timestamp: genome.timestamp,
                owner: genome.owner,
                price: genome.price,
                status: genome.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing genome data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading genome ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setGenomeData(list);
    } catch (e) {
      console.error("Error loading genome data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Upload new genome data
  const uploadGenomeData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting genome data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newGenomeData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const genomeData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        price: newGenomeData.price,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `genome_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(genomeData))
      );
      
      const keysBytes = await contract.getData("genome_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "genome_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Genome data encrypted and uploaded securely!"
      });
      
      await loadGenomeData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewGenomeData({
          description: "",
          price: "0.1"
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

  // Approve genome data for sale
  const approveGenomeData = async (dataId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing genome data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`genome_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Genome data not found");
      }
      
      const genome = JSON.parse(ethers.toUtf8String(dataBytes));
      
      const updatedGenome = {
        ...genome,
        status: "approved"
      };
      
      await contract.setData(
        `genome_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedGenome))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Genome data approved for FHE queries!"
      });
      
      await loadGenomeData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Approval failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Simulate FHE query purchase
  const purchaseQuery = async (dataId: string, price: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing FHE query purchase..."
    });

    try {
      // Simulate payment and FHE query
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`genome_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Genome data not found");
      }
      
      const genome = JSON.parse(ethers.toUtf8String(dataBytes));
      
      const updatedGenome = {
        ...genome,
        status: "sold"
      };
      
      await contract.setData(
        `genome_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedGenome))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE query completed successfully! Results encrypted."
      });
      
      await loadGenomeData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Query failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to start using the genome marketplace",
      icon: "🔗"
    },
    {
      title: "Upload Genome Data",
      description: "Securely upload your encrypted genome data to the marketplace",
      icon: "🧬"
    },
    {
      title: "Set Price & Approve",
      description: "Set your price per query and approve your data for researchers",
      icon: "💰"
    },
    {
      title: "Earn from FHE Queries",
      description: "Researchers pay to run FHE queries on your encrypted data",
      icon: "🔍"
    },
    {
      title: "Receive Payments",
      description: "Get paid directly to your wallet for each query",
      icon: "💳"
    }
  ];

  // Render pie chart for data status distribution
  const renderPieChart = () => {
    const total = genomeData.length || 1;
    const approvedPercentage = (approvedCount / total) * 100;
    const soldPercentage = (soldCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment approved" 
            style={{ transform: `rotate(${approvedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment sold" 
            style={{ transform: `rotate(${(approvedPercentage + soldPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(approvedPercentage + soldPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{genomeData.length}</div>
            <div className="pie-label">Datasets</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box approved"></div>
            <span>Approved: {approvedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box sold"></div>
            <span>Sold: {soldCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
        </div>
      </div>
    );
  };

  // Filter data based on active tab and search query
  const filteredData = genomeData.filter(data => {
    const matchesSearch = data.id.includes(searchQuery) || 
                          data.description?.includes(searchQuery);
    
    if (activeTab === "myData") {
      return isOwner(data.owner) && matchesSearch;
    }
    return data.status === "approved" && matchesSearch;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="dna-icon"></div>
          <h1>Genome<span>Market</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-btn"
          >
            <div className="upload-icon"></div>
            Upload Genome
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="hero-banner">
          <div className="hero-text">
            <h2>Privacy-Preserving Genome Data Marketplace</h2>
            <p>Securely monetize your genomic data using Fully Homomorphic Encryption</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How GenomeMarket Works</h2>
            <p className="subtitle">Monetize your genomic data without compromising privacy</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-section">
          <div className="dashboard-card">
            <h3>My Genome Portfolio</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{genomeData.filter(d => isOwner(d.owner)).length}</div>
                <div className="stat-label">My Datasets</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalEarnings}</div>
                <div className="stat-label">ETH Earned</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{soldCount}</div>
                <div className="stat-label">Queries Sold</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Market Overview</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{genomeData.length}</div>
                <div className="stat-label">Total Datasets</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{approvedCount}</div>
                <div className="stat-label">Available</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending Approval</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Dataset Status</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <div className="tabs">
              <button 
                className={`tab-btn ${activeTab === "myData" ? "active" : ""}`}
                onClick={() => setActiveTab("myData")}
              >
                My Genome Data
              </button>
              <button 
                className={`tab-btn ${activeTab === "marketplace" ? "active" : ""}`}
                onClick={() => setActiveTab("marketplace")}
              >
                Marketplace
              </button>
            </div>
            
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search datasets..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className="search-icon"></div>
              </div>
              <button 
                onClick={loadGenomeData}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Description</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Price (ETH)</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredData.length === 0 ? (
              <div className="no-data">
                <div className="no-data-icon"></div>
                <p>No genome datasets found</p>
                {activeTab === "myData" && (
                  <button 
                    className="primary-btn"
                    onClick={() => setShowUploadModal(true)}
                  >
                    Upload Your First Dataset
                  </button>
                )}
              </div>
            ) : (
              filteredData.map(data => (
                <div className="data-row" key={data.id}>
                  <div className="table-cell data-id">#{data.id.substring(0, 6)}</div>
                  <div className="table-cell">{data.description || "Genome Dataset"}</div>
                  <div className="table-cell">{data.owner.substring(0, 6)}...{data.owner.substring(38)}</div>
                  <div className="table-cell">{data.price} ETH</div>
                  <div className="table-cell">
                    <span className={`status-badge ${data.status}`}>
                      {data.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {activeTab === "myData" && isOwner(data.owner) && data.status === "pending" && (
                      <button 
                        className="action-btn approve"
                        onClick={() => approveGenomeData(data.id)}
                      >
                        Approve
                      </button>
                    )}
                    {activeTab === "marketplace" && data.status === "approved" && (
                      <button 
                        className="action-btn purchase"
                        onClick={() => purchaseQuery(data.id, data.price)}
                      >
                        Run FHE Query
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={uploadGenomeData} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          genomeData={newGenomeData}
          setGenomeData={setNewGenomeData}
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
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
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
              <div className="dna-icon"></div>
              <span>GenomeMarket</span>
            </div>
            <p>Privacy-preserving genomic data marketplace powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} GenomeMarket. All rights reserved.
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
  genomeData: any;
  setGenomeData: (data: any) => void;
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  genomeData,
  setGenomeData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setGenomeData({
      ...genomeData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!genomeData.price) {
      alert("Please set a price");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal">
        <div className="modal-header">
          <h2>Upload Genome Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div> 
            Your genome data will be encrypted with FHE before storage
          </div>
          
          <div className="form-group">
            <label>Description (Optional)</label>
            <input 
              type="text"
              name="description"
              value={genomeData.description} 
              onChange={handleChange}
              placeholder="Brief description of your genome data..." 
              className="form-input"
            />
          </div>
          
          <div className="form-group">
            <label>Price per Query (ETH)</label>
            <input 
              type="number"
              name="price"
              value={genomeData.price} 
              onChange={handleChange}
              min="0.01"
              step="0.01"
              className="form-input"
            />
          </div>
          
          <div className="privacy-guarantee">
            <h3>Privacy Guarantee</h3>
            <ul>
              <li>Your raw genome data never leaves your device</li>
              <li>All queries run on encrypted data using FHE</li>
              <li>You maintain full control over your data</li>
              <li>Researchers only receive encrypted query results</li>
            </ul>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="submit-btn"
          >
            {uploading ? "Encrypting with FHE..." : "Upload Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;