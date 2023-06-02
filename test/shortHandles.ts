import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { KnowledgeLayerID, KnowledgeLayerPlatformID } from '../typechain-types';
import { MintStatus } from '../utils/constants';
import { deploy } from '../utils/deploy';

const handles = [
  {
    handle: 'a',
    price: 200,
  },
  {
    handle: 'ab',
    price: 100,
  },
  {
    handle: 'abc',
    price: 50,
  },
  {
    handle: 'abcd',
    price: 25,
  },
];

describe('Mint short handles', function () {
  let knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    deployer: SignerWithAddress,
    platformOwner: SignerWithAddress,
    users: SignerWithAddress[];

  const platformId = 1;

  before(async function () {
    [deployer, platformOwner, ...users] = await ethers.getSigners();
    [knowledgeLayerID, knowledgeLayerPlatformID] = await deploy();

    // Disable whitelist for reserved handles
    await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);

    // Deployer mints Platform Id for Carol
    const platformName = 'hirevibes';
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(deployer.address);
    await knowledgeLayerPlatformID
      .connect(deployer)
      .mintForAddress(platformName, platformOwner.address);
  });

  it('The price for short handles is correct', async function () {
    for (const handle of handles) {
      const price = await knowledgeLayerID.getHandlePrice(handle.handle);
      expect(price).to.equal(ethers.utils.parseEther(handle.price.toString()));
    }
  });

  it('The price for regular handles is correct', async function () {
    const priceBefore = await knowledgeLayerID.getHandlePrice('abcde');
    expect(priceBefore).to.equal(0);

    // Update mint fee
    const mintFee = 100;
    await knowledgeLayerID.connect(deployer).updateMintFee(mintFee);
    const priceAfter = await knowledgeLayerID.getHandlePrice('abcde');
    expect(priceAfter).to.equal(mintFee);
  });

  it('Users can mint a short handle paying the fee', async function () {
    for (const [index, handle] of handles.entries()) {
      const user = users[index];
      const price = ethers.utils.parseEther(handle.price.toString());

      const failedTx = knowledgeLayerID
        .connect(user)
        .mint(platformId, handle.handle, { value: price.sub(1) });
      await expect(failedTx).to.be.revertedWith('Incorrect amount of ETH for mint fee');

      const tx = await knowledgeLayerID
        .connect(user)
        .mint(platformId, handle.handle, { value: price });
      await tx.wait();

      await expect(tx).to.changeEtherBalances(
        [knowledgeLayerID.address, user],
        [price, (-price).toString()],
      );
    }
  });

  it('Owner can update the max price for a short handle', async function () {
    const maxPrice = 10000;
    await knowledgeLayerID.connect(deployer).updateShortHandlesMaxPrice(maxPrice);

    for (const handle of handles) {
      const price = await knowledgeLayerID.getHandlePrice(handle.handle);
      const expectedPrice = maxPrice / Math.pow(2, handle.handle.length - 1);
      expect(price).to.equal(expectedPrice);
    }
  });
});
