import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { KnowledgeLayerArbitrator, KnowledgeLayerPlatformID } from '../typechain-types';
import { deploy } from '../utils/deploy';
import { DisputeStatus } from '../utils/constants';

describe('KnowledgeLayerArbitrator', () => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    arbitrableContract: SignerWithAddress,
    alicePlatformId: BigNumber,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    knowledgeLayerArbitrator: KnowledgeLayerArbitrator;

  const disputeId = 0;
  const choices = 2;

  before(async () => {
    [deployer, alice, bob, arbitrableContract] = await ethers.getSigners();
    [, knowledgeLayerPlatformID, , , , knowledgeLayerArbitrator] = await deploy();

    // Add Alice to whitelist and mint platform ID
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(alice.address);
    await knowledgeLayerPlatformID.connect(alice).mint('alice-platform');
    alicePlatformId = await knowledgeLayerPlatformID.connect(alice).ids(alice.address);
  });

  describe('Set arbitration price', async () => {
    const newArbitrationPrice = 1000;

    it("Can't set arbitration price if not owner", async () => {
      const tx = knowledgeLayerArbitrator
        .connect(bob)
        .setArbitrationPrice(alicePlatformId, newArbitrationPrice);
      await expect(tx).to.be.revertedWith("You're not the owner of the platform");
    });

    it('The platform owner can update the arbitration price', async function () {
      await knowledgeLayerArbitrator
        .connect(alice)
        .setArbitrationPrice(alicePlatformId, newArbitrationPrice);
      const extraData = ethers.utils.hexZeroPad(ethers.utils.hexlify(alicePlatformId), 32);
      const updatedArbitrationPrice = await knowledgeLayerArbitrator.arbitrationCost(extraData);
      expect(updatedArbitrationPrice).to.be.equal(newArbitrationPrice);
    });
  });

  describe('Create dispute', async () => {
    let arbitrationCost: BigNumber;
    let extraData: string;

    before(async () => {
      extraData = ethers.utils.hexZeroPad(ethers.utils.hexlify(alicePlatformId), 32);
      arbitrationCost = await knowledgeLayerArbitrator.arbitrationCost(extraData);
    });

    it("Can't create dispute if not paying arbitration cost", async () => {
      const tx = knowledgeLayerArbitrator
        .connect(arbitrableContract)
        .createDispute(choices, extraData, {
          value: arbitrationCost.sub(1),
        });
      await expect(tx).to.be.revertedWith('Not enough ETH to cover arbitration costs.');
    });

    describe('Successfull creation of dispute', async () => {
      before(async () => {
        const tx = await knowledgeLayerArbitrator
          .connect(arbitrableContract)
          .createDispute(choices, extraData, { value: arbitrationCost });
        await tx.wait();
      });

      it('Creates a dispute with the correct data', async () => {
        const dispute = await knowledgeLayerArbitrator.disputes(disputeId);
        expect(dispute.arbitrated).to.be.equal(arbitrableContract.address);
        expect(dispute.choices).to.be.equal(choices);
        expect(dispute.fee).to.be.equal(arbitrationCost);
        expect(dispute.ruling).to.be.equal(0);
        expect(dispute.status).to.be.equal(DisputeStatus.Waiting);
        expect(dispute.platformId).to.be.equal(alicePlatformId);
      });

      it("The dispute status is 'Waiting'", async () => {
        const disputeStatus = await knowledgeLayerArbitrator.disputeStatus(disputeId);
        expect(disputeStatus).to.be.equal(DisputeStatus.Waiting);
      });

      it('The dispute current ruling is 0', async () => {
        const disputeRuling = await knowledgeLayerArbitrator.currentRuling(disputeId);
        expect(disputeRuling).to.be.equal(0);
      });
    });
  });

  describe('Give ruling', async () => {
    const ruling = 1;

    it("Can't give a ruling if not platform owner", async () => {
      const tx = knowledgeLayerArbitrator.connect(bob).giveRuling(disputeId, ruling);
      await expect(tx).to.be.revertedWith("You're not the owner of the platform");
    });

    it("Can't give an invalid ruling", async () => {
      const tx = knowledgeLayerArbitrator.connect(alice).giveRuling(disputeId, choices + 1);
      await expect(tx).to.be.revertedWith('Invalid ruling.');
    });
  });
});
