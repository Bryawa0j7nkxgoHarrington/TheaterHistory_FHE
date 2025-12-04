// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TheaterHistoryFHE is SepoliaConfig {

    struct EncryptedScript {
        uint256 id;
        euint32 encryptedTitle;
        euint32 encryptedContent;
        euint32 encryptedAuthor;
        uint256 timestamp;
    }

    struct DecryptedScript {
        string title;
        string content;
        string author;
        bool isRevealed;
    }

    uint256 public scriptCount;
    mapping(uint256 => EncryptedScript) public encryptedScripts;
    mapping(uint256 => DecryptedScript) public decryptedScripts;

    mapping(string => euint32) private encryptedAuthorCount;
    string[] private authorList;

    mapping(uint256 => uint256) private requestToScriptId;

    event ScriptSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event ScriptDecrypted(uint256 indexed id);

    modifier onlyResearcher(uint256 scriptId) {
        _;
    }

    function submitEncryptedScript(
        euint32 encryptedTitle,
        euint32 encryptedContent,
        euint32 encryptedAuthor
    ) public {
        scriptCount += 1;
        uint256 newId = scriptCount;

        encryptedScripts[newId] = EncryptedScript({
            id: newId,
            encryptedTitle: encryptedTitle,
            encryptedContent: encryptedContent,
            encryptedAuthor: encryptedAuthor,
            timestamp: block.timestamp
        });

        decryptedScripts[newId] = DecryptedScript({
            title: "",
            content: "",
            author: "",
            isRevealed: false
        });

        emit ScriptSubmitted(newId, block.timestamp);
    }

    function requestScriptDecryption(uint256 scriptId) public onlyResearcher(scriptId) {
        EncryptedScript storage script = encryptedScripts[scriptId];
        require(!decryptedScripts[scriptId].isRevealed, "Already decrypted");

        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(script.encryptedTitle);
        ciphertexts[1] = FHE.toBytes32(script.encryptedContent);
        ciphertexts[2] = FHE.toBytes32(script.encryptedAuthor);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptScript.selector);
        requestToScriptId[reqId] = scriptId;

        emit DecryptionRequested(scriptId);
    }

    function decryptScript(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 scriptId = requestToScriptId[requestId];
        require(scriptId != 0, "Invalid request");

        EncryptedScript storage eScript = encryptedScripts[scriptId];
        DecryptedScript storage dScript = decryptedScripts[scriptId];
        require(!dScript.isRevealed, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory results = abi.decode(cleartexts, (string[]));

        dScript.title = results[0];
        dScript.content = results[1];
        dScript.author = results[2];
        dScript.isRevealed = true;

        if (!FHE.isInitialized(encryptedAuthorCount[dScript.author])) {
            encryptedAuthorCount[dScript.author] = FHE.asEuint32(0);
            authorList.push(dScript.author);
        }
        encryptedAuthorCount[dScript.author] = FHE.add(
            encryptedAuthorCount[dScript.author],
            FHE.asEuint32(1)
        );

        emit ScriptDecrypted(scriptId);
    }

    function getDecryptedScript(uint256 scriptId) public view returns (
        string memory title,
        string memory content,
        string memory author,
        bool isRevealed
    ) {
        DecryptedScript storage s = decryptedScripts[scriptId];
        return (s.title, s.content, s.author, s.isRevealed);
    }

    function getEncryptedAuthorCount(string memory author) public view returns (euint32) {
        return encryptedAuthorCount[author];
    }

    function requestAuthorCountDecryption(string memory author) public {
        euint32 count = encryptedAuthorCount[author];
        require(FHE.isInitialized(count), "Author not found");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAuthorCount.selector);
        requestToScriptId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(author)));
    }

    function decryptAuthorCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 authorHash = requestToScriptId[requestId];
        string memory author = getAuthorFromHash(authorHash);

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 count = abi.decode(cleartexts, (uint32));
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getAuthorFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < authorList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(authorList[i]))) == hash) {
                return authorList[i];
            }
        }
        revert("Author not found");
    }
}
