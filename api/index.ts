import app from '../server';

export default function handler(req, res) {
  return app(req, res);
}
