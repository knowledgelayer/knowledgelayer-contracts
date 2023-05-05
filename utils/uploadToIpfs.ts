import hre from 'hardhat';
import { create } from 'ipfs-http-client';

const uploadToIPFS = async (data: Record<string, unknown>) => {
  const network = hre.network.name;
  const url = network === 'localhost' ? 'http://localhost:5001' : 'https://ipfs.infura.io:5001';

  try {
    const ipfs = create({
      url,
      headers: {
        authorization:
          network === 'localhost'
            ? ''
            : 'Basic ' + btoa(process.env.INFURA_ID + ':' + process.env.INFURA_SECRET),
      },
    });

    const result = await ipfs.add(JSON.stringify(data));
    return result.path;
  } catch (error) {
    console.error('IPFS error ', error);
  }
};

export default uploadToIPFS;
