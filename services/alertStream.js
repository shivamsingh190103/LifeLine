const crypto = require('crypto');
const { haversineDistanceKm } = require('./geo');

const DEFAULT_ALERT_RADIUS_KM = 5;
const HEARTBEAT_MS = 25000;

const normalizeBloodGroup = value => (typeof value === 'string' ? value.trim().toUpperCase() : '');

const parsePositiveFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

class AlertStream {
  constructor() {
    this.clients = new Map();
    this.heartbeatTimer = setInterval(() => {
      const heartbeatPayload = JSON.stringify({ timestamp: new Date().toISOString() });
      for (const [clientId, client] of this.clients.entries()) {
        try {
          client.res.write(`event: heartbeat\ndata: ${heartbeatPayload}\n\n`);
        } catch (error) {
          this.clients.delete(clientId);
        }
      }
    }, HEARTBEAT_MS);

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  addClient(res, { userId = null, bloodGroup = null, latitude = null, longitude = null, radiusKm = DEFAULT_ALERT_RADIUS_KM } = {}) {
    const clientId = crypto.randomUUID();
    const normalizedClient = {
      id: clientId,
      userId,
      bloodGroup: normalizeBloodGroup(bloodGroup),
      latitude,
      longitude,
      radiusKm: parsePositiveFloat(radiusKm, DEFAULT_ALERT_RADIUS_KM),
      connectedAt: new Date().toISOString(),
      res
    };

    this.clients.set(clientId, normalizedClient);
    res.write(`event: connected\ndata: ${JSON.stringify({
      clientId,
      connectedAt: normalizedClient.connectedAt
    })}\n\n`);

    return clientId;
  }

  removeClient(clientId) {
    this.clients.delete(clientId);
  }

  broadcastEmergencyAlert({
    requestId,
    bloodGroup,
    latitude,
    longitude,
    radiusKm = DEFAULT_ALERT_RADIUS_KM,
    payload = {}
  }) {
    if (latitude === null || longitude === null) {
      return 0;
    }

    const normalizedBloodGroup = normalizeBloodGroup(bloodGroup);
    const normalizedRadiusKm = parsePositiveFloat(radiusKm, DEFAULT_ALERT_RADIUS_KM);
    let delivered = 0;

    for (const [clientId, client] of this.clients.entries()) {
      try {
        if (client.latitude === null || client.longitude === null) {
          continue;
        }

        if (client.bloodGroup && normalizedBloodGroup && client.bloodGroup !== normalizedBloodGroup) {
          continue;
        }

        const distanceKm = haversineDistanceKm(
          latitude,
          longitude,
          client.latitude,
          client.longitude
        );

        if (distanceKm > Math.min(client.radiusKm, normalizedRadiusKm)) {
          continue;
        }

        delivered += 1;
        const eventPayload = {
          ...payload,
          request_id: requestId,
          blood_group: normalizedBloodGroup,
          distance_km: Number.parseFloat(distanceKm.toFixed(2)),
          timestamp: new Date().toISOString()
        };

        client.res.write(`event: emergency-alert\ndata: ${JSON.stringify(eventPayload)}\n\n`);
      } catch (error) {
        this.clients.delete(clientId);
      }
    }

    return delivered;
  }

  getStats() {
    return {
      connectedClients: this.clients.size,
      clients: Array.from(this.clients.values()).map(client => ({
        id: client.id,
        userId: client.userId,
        bloodGroup: client.bloodGroup,
        connectedAt: client.connectedAt
      }))
    };
  }
}

module.exports = new AlertStream();
