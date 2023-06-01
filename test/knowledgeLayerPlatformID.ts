import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { KnowledgeLayerPlatformID } from '../typechain-types';
import deploy from '../utils/deploy';
import { MintStatus } from '../utils/constants';

describe('KnowledgeLayerPlatformID', () => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    aliceId: BigNumber,
    bob: SignerWithAddress,
    carol: SignerWithAddress,
    dave: SignerWithAddress,
    frank: SignerWithAddress,
    carolPlatformId: BigNumber,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID;

  before(async () => {
    [deployer, alice, bob, carol, dave, , frank] = await ethers.getSigners();
    [, knowledgeLayerPlatformID] = await deploy();
  });

  describe('Mint platform profile', async () => {
    const mintFee = 100;

    describe('Minting paused', async () => {
      it('The deployer can pause the minting', async () => {
        await knowledgeLayerPlatformID.connect(deployer).updateMintStatus(MintStatus.ON_PAUSE);
        const mintStatus = await knowledgeLayerPlatformID.connect(deployer).mintStatus();

        expect(mintStatus).to.be.equal(MintStatus.ON_PAUSE);
      });

      it("Can't mint an ID when minting is paused", async () => {
        const tx = knowledgeLayerPlatformID.connect(alice).mint('alice-platform');
        await expect(tx).to.be.revertedWith('Mint status is not valid');
      });
    });

    describe('Minting with whitelist', async () => {
      it('The deployer can make minting only whistelited', async () => {
        await knowledgeLayerPlatformID
          .connect(deployer)
          .updateMintStatus(MintStatus.ONLY_WHITELIST);
        const mintStatus = await knowledgeLayerPlatformID.connect(deployer).mintStatus();

        expect(mintStatus).to.be.equal(MintStatus.ONLY_WHITELIST);
      });

      it("Can't mint an ID if not whitelisted", async () => {
        const tx = knowledgeLayerPlatformID.connect(alice).mint('alice-platform');
        await expect(tx).to.be.revertedWith('You are not whitelisted');
      });

      it('The deployer can whitelist an address', async () => {
        await knowledgeLayerPlatformID.connect(deployer).whitelistUser(alice.address);

        const isWhitelisted = await knowledgeLayerPlatformID.whitelist(alice.address);
        expect(isWhitelisted).to.be.equal(true);
      });

      it('Can mint an ID if whitelisted', async () => {
        await knowledgeLayerPlatformID.connect(alice).mint('alice-platform');
        expect(await knowledgeLayerPlatformID.balanceOf(alice.address)).to.be.equal(1);
      });
    });

    describe('Public minting', async () => {
      it('The deployer can make minting public', async function () {
        await knowledgeLayerPlatformID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
        const mintStatus = await knowledgeLayerPlatformID.connect(deployer).mintStatus();

        expect(mintStatus).to.be.equal(MintStatus.PUBLIC);
      });

      it('Mint an ID', async () => {
        const platformName = 'bob-platform';
        const totalSupplyBefore = await knowledgeLayerPlatformID.totalSupply();

        const tx = await knowledgeLayerPlatformID.connect(bob).mint(platformName);
        const receipt = await tx.wait();

        // Check that the ID was set correctly
        const platformId: BigNumber = receipt.events?.find((e) => e.event === 'Mint')?.args
          ?.platformId;
        expect(await knowledgeLayerPlatformID.ids(bob.address)).to.be.equal(platformId);

        // Check that the token was minted correctly
        await expect(tx).to.changeTokenBalance(knowledgeLayerPlatformID, bob, 1);
        expect(await knowledgeLayerPlatformID.ownerOf(platformId)).to.be.equal(bob.address);

        // Check that the profile name was saved correctly
        const platformData = await knowledgeLayerPlatformID.platforms(platformId);
        expect(platformData.name).to.be.equal(platformName);

        // Check that the total supply was updated
        const totalSupplyAfter = await knowledgeLayerPlatformID.totalSupply();
        expect(totalSupplyAfter).to.be.equal(totalSupplyBefore.add(1));

        // Check that the token URI was saved correctly
        const tokenURI = await knowledgeLayerPlatformID.tokenURI(platformId);
        expect(tokenURI).to.be.not.null;
      });
    });

    describe('Mint fee', async () => {
      it('The deployer can update the mint fee', async function () {
        await knowledgeLayerPlatformID.connect(deployer).updateMintFee(mintFee);
        const updatedMintFee = await knowledgeLayerPlatformID.mintFee();

        expect(updatedMintFee).to.be.equal(mintFee);
      });

      it("Can't mint an ID without paying the fee", async () => {
        const tx = knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
        await expect(tx).to.be.revertedWith('Incorrect amount of ETH for mint fee');
      });

      it('Can mint an ID paying the fee', async () => {
        const tx = await knowledgeLayerPlatformID.connect(carol).mint('carol-platform', {
          value: mintFee,
        });
        await expect(tx).to.changeTokenBalance(knowledgeLayerPlatformID, carol, 1);
      });
    });

    describe('Mint for address', async () => {
      it("Can't mint for an address if don't have the mint role", async () => {
        const mintRole = await knowledgeLayerPlatformID.MINT_ROLE();
        await expect(
          knowledgeLayerPlatformID.connect(alice).mintForAddress('dave-platform', dave.address, {
            value: mintFee,
          }),
        ).to.be.revertedWith(
          `AccessControl: account ${alice.address.toLowerCase()} is missing role ${mintRole.toLowerCase()}`,
        );
      });

      it('Can mint for an address if have the mint role', async () => {
        // Grant mint role to alice
        const mintRole = await knowledgeLayerPlatformID.MINT_ROLE();
        await knowledgeLayerPlatformID.connect(deployer).grantRole(mintRole, alice.address);

        const tx = await knowledgeLayerPlatformID
          .connect(alice)
          .mintForAddress('dave-platform', dave.address, {
            value: mintFee,
          });
        await expect(tx).to.changeTokenBalance(knowledgeLayerPlatformID, dave, 1);
      });
    });
  });
});
