import { create } from 'ipfs-http-client';

const IPFS_URL: Record<string, string> = {
  localhost: 'http://localhost:5001',
  infura: 'https://ipfs.infura.io:5001',
};

const uploadToIPFS = async (network: string, data: Record<string, unknown>) => {
  try {
    const authorization = 'Basic ' + btoa(process.env.INFURA_ID + ':' + process.env.INFURA_SECRET);
    const ipfs = create({
      url: IPFS_URL[network],
      headers: {
        authorization,
      },
    });

    const result = await ipfs.add(JSON.stringify(data));
    return result.path;
  } catch (error) {
    console.error('IPFS error ', error);
  }
};

export default uploadToIPFS;
