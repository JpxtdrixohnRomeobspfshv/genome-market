// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract GenomeDataMarketFHE is SepoliaConfig {
    struct EncryptedGenome {
        uint256 id;
        euint32 encryptedData;
        euint32 encryptedMetadata;
        uint256 timestamp;
    }

    struct DecryptedGenome {
        string data;
        string metadata;
        bool isRevealed;
    }

    uint256 public genomeCount;
    mapping(uint256 => EncryptedGenome) public encryptedGenomes;
    mapping(uint256 => DecryptedGenome) public decryptedGenomes;

    mapping(string => euint32) private encryptedCategoryCount;
    string[] private categoryList;

    mapping(uint256 => uint256) private requestToGenomeId;

    event GenomeSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event GenomeDecrypted(uint256 indexed id);

    modifier onlyOwner(uint256 genomeId) {
        _;
    }

    function submitEncryptedGenome(euint32 encryptedData, euint32 encryptedMetadata) public {
        genomeCount += 1;
        uint256 newId = genomeCount;

        encryptedGenomes[newId] = EncryptedGenome({
            id: newId,
            encryptedData: encryptedData,
            encryptedMetadata: encryptedMetadata,
            timestamp: block.timestamp
        });

        decryptedGenomes[newId] = DecryptedGenome({
            data: "",
            metadata: "",
            isRevealed: false
        });

        emit GenomeSubmitted(newId, block.timestamp);
    }

    function requestGenomeDecryption(uint256 genomeId) public onlyOwner(genomeId) {
        EncryptedGenome storage genome = encryptedGenomes[genomeId];
        require(!decryptedGenomes[genomeId].isRevealed, "Already decrypted");

        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(genome.encryptedData);
        ciphertexts[1] = FHE.toBytes32(genome.encryptedMetadata);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptGenome.selector);
        requestToGenomeId[reqId] = genomeId;

        emit DecryptionRequested(genomeId);
    }

    function decryptGenome(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        uint256 genomeId = requestToGenomeId[requestId];
        require(genomeId != 0, "Invalid request");

        EncryptedGenome storage eGenome = encryptedGenomes[genomeId];
        DecryptedGenome storage dGenome = decryptedGenomes[genomeId];
        require(!dGenome.isRevealed, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory results = abi.decode(cleartexts, (string[]));
        dGenome.data = results[0];
        dGenome.metadata = results[1];
        dGenome.isRevealed = true;

        emit GenomeDecrypted(genomeId);
    }

    function getDecryptedGenome(uint256 genomeId) public view returns (string memory data, string memory metadata, bool isRevealed) {
        DecryptedGenome storage g = decryptedGenomes[genomeId];
        return (g.data, g.metadata, g.isRevealed);
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
}
