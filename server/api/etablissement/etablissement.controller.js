'use strict';

var _ = require('lodash');
var async = require('async');
var wkhtmltopdf = require('wkhtmltopdf');
var iconv = require('iconv-lite');

var data = require('./DEPP-etab.json');
var Etablissement = require('./etablissement.model');
var User = require('../user/user.model');
var Demande = require('../demande/demande.model');
var crypto = require('../../components/crypto/crypto');
var duplicates = require('../../components/duplicates/duplicates');
var GeneratorPdf = require('../../components/generators/pdf/pdf');
var GeneratorCsv = require('../../components/generators/csv/csv');

function validationError(res, statusCode) {
  statusCode = statusCode || 422;
  return function(err) {
    return res.status(statusCode).json(err);
  };
}

exports.show = function(req, res) {
  return res.json(req.etablissement);
};

exports.showById = function(req, res) {
  return res.json(req.etablissement);
};

exports.showByRne = function(req, res) {
  // Sample data
  // {
  //   "numero_uai": "0010002X",
  //   "appellation_officielle": "Collège Saint-Exupéry",
  //   "denomination_principale": "COLLEGE",
  //   "patronyme_uai": "SAINT-EXUPERY",
  //   "secteur_public_prive_libe": "Public",
  //   "adresse_uai": "6  RUE AGUETANT",
  //   "lieu_dit_uai": "",
  //   "boite_postale_uai": "508",
  //   "code_postal_uai": "1500",
  //   "localite_acheminement_uai": "AMBERIEU EN BUGEY",
  //   "coordonnee_x": "882408,3",
  //   "coordonnee_y": "6543019,6",
  //   "appariement": "MANUEL",
  //   "localisation": "BATIMENT",
  //   "nature_uai": "340",
  //   "nature_uai_libe": "Collège",
  //   "etat_etablissement": "1"
  // },

  const etablissementId = req.params.rne ? req.params.rne.toUpperCase() : null;

  const etablissement = _.find(data, function(current) {
    return etablissementId == current.numero_uai.toUpperCase();
  });

  if (etablissement) {
    const college = new Etablissement();

    college.human_id = etablissement.numero_uai;
    college.nom = etablissement.appellation_officielle;
    college.type = etablissement.nature_uai_libe;
    college.adresse = etablissement.adresse_uai;
    college.ville = {
      nom: etablissement.localite_acheminement_uai,
      codePostal: etablissement.code_postal_uai
    };

    return res.json(college);
  } else {
    return res.sendStatus(404);
  }
};

exports.query = function(req, res) {
  Etablissement
    .find()
    .exec(function(err, etablissements) {
      if (err) { return handleError(req, res, err); }

      if (!etablissements) { return res.sendStatus(404); }

      return res.json(etablissements);
    });
};

exports.create = function(req, res) {
  Etablissement
    .create(_.omit(req.body, 'password'), function(err, etablissement) {
      if (err) { return handleError(req, res, err); }

      User.create({email: etablissement.contact, password: req.body.password, etablissement: etablissement._id}, function(userError) {
        if (userError) {
          Etablissement.remove(etablissement._id);

          return handleError(req, res, userError);
        }

        return res.json(etablissement);
      });
    });
};

function decode(demandes) {
  return _.map(demandes, crypto.decode);
}

exports.wrongYear = function(req, res) {
  var query = {etablissement: req.etablissement, 'data.data.anneeImpots': {$ne: '2017'}};

  Demande
    .find(query)
    .exec(function(err, demandes) {
      var decoded = decode(demandes);
      return res.json(decoded);
    });
};

exports.count = function(req, res) {
  // status: ... ['new', 'pending', 'pause', 'error', 'done'] ...
  async.parallel({
    new: function(callback) {
      Demande.count({
        etablissement: req.etablissement,
        status: {$in: ['new', 'pending']}
      }).exec(callback);
    },

    pause: function(callback) {
      Demande.count({
        etablissement: req.etablissement,
        status: 'pause'
      }).exec(callback);
    },

    error: function(callback) {
      Demande.count({
        etablissement: req.etablissement,
        status: 'error'
      }).exec(callback);
    },

    done: function(callback) {
      Demande.count({
        etablissement: req.etablissement,
        status: 'done'
      }).exec(callback);
    }

  }, function(err, result) {
    if (err) {
      return handleError(req, res, err);
    }

    return res.json(result);
  });
};

function createPdfArchive(req, res, type) {
  Demande
    .find({status: 'done', etablissement: req.etablissement._id})
    .exec(function(err, demandes) {
      if (err) { return handleError(req, res, err); }

      var sortedDemandes = demandes.sort(function(demandeA, demandeB) {
        return demandeA.compare(demandeB, 'adulte');
      });

      GeneratorPdf.createPdfArchive(sortedDemandes, req.etablissement, req.hostname, {type}, function(err, archive, cleanupCallback) {
        if (err) { return handleError(req, res, err); }

        archive.on('finish', function() {
          cleanupCallback();
        });

        archive.on('error', function(err) {
          res.status(500).send({error: err.message});
        });

        archive.on('error', function(err) {
          throw err;
        });

        archive.pipe(res);
        archive.finalize();
      });
    });
}

exports.notifications = function(req, res) {
  return createPdfArchive(req, res, 'notification');
};

exports.campagne = function(req, res) {
  return createPdfArchive(req, res, 'campagne');
};

exports.listeDemandes = function(req, res) {
  if (!req.query.csv) {
    return createPdfArchive(req, res, 'demande');
  } else {
    Demande
      .find({etablissement: req.etablissement._id})
      .sort('-createdAt')
      .exec(function(err, demandes) {
        if (err) { return handleError(req, res, err); }

        GeneratorCsv.generate(demandes, req.etablissement, function(err, csv) {
          if (err) { return handleError(req, res, err); }

          var buffer = iconv.encode(csv, 'utf16le');

          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-16le; header=present;'
          });

          res.write(new Buffer([0xff, 0xfe]));
          res.write(buffer);
          return res.end();
        });
      });
  }
};

exports.listeRIBs = function(req, res) {
  var host = req.headers.host;
  Demande
    .find({status: 'done', 'notification.montant': {$ne: 0}, etablissement: req.etablissement._id})
    .exec(function(err, demandes) {

      var sortedDemandes = demandes.sort(function(demandeA, demandeB) {
        return demandeA.compare(demandeB, 'adulte');
      });

      var html = GeneratorPdf.editRib(sortedDemandes, req.etablissement, host);
      wkhtmltopdf(html, {encoding: 'UTF-8', 'page-size': 'A4'}).pipe(res);
    });
};

exports.aideSiecle = function(req, res) {
  var host = req.headers.host;
  Demande
    .find({etablissement: req.etablissement._id})
    .exec(function(err, demandes) {

      var sortedDemandes = demandes.sort(function(demandeA, demandeB) {
        return demandeA.compare(demandeB, 'enfant');
      });

      var html = GeneratorPdf.editSiecle(sortedDemandes, req.etablissement, host);
      wkhtmltopdf(html, {encoding: 'UTF-8', 'page-size': 'A4'}).pipe(res);
    });
};

function getCorrespondingExpression(sortType) {
  switch (sortType) {
  case 'enfant':
    return 'data.identiteEnfant.nom';
  case 'adulte':
    return 'data.identiteAdulte.demandeur.nom';
  case 'email':
    return 'data.identiteAdulte.email';
  case 'taux':
    return 'notification.montant';
  default:
    return sortType;
  }
}

exports.demandes = function(req, res) {
  var q;
  var limit;
  var offset;
  var sort;

  if (req.query.searchQuery) {
    var searchQuery = JSON.parse(req.query.searchQuery);
    q = searchQuery.q && _.isString(searchQuery.q) && searchQuery.q.length ? searchQuery.q : null;
    offset = parseInt(searchQuery.offset);
    offset = _.isNumber(offset) && offset > 0 ? Math.floor(offset) : 0;
    limit = parseInt(searchQuery.limit);
    limit = _.isNumber(limit) ? limit : 10;

    var reverse = searchQuery.reverse || false;
    var sortQuery = searchQuery.sort || 'createdAt';
    var sortExpression = getCorrespondingExpression(sortQuery);
    sort = {[sortExpression]: reverse ? -1 : 1};
  } else {
    q = null;
    offset = 0;
    limit = null;
    sort = '-createdAt';
  }

  var query = {etablissement: req.etablissement};
  if (req.query.status) {
    var status = req.query.status === 'new' ?  ['new', 'pending'] : [req.query.status];
    query.status = {$in: status};
  }

  // Text search
  if (q) {
    query.$text = { $search: q, $language: 'french' };
  }

  async.parallel({
    demandes: function(callback) {
      async.waterfall([
        function(waterFallCallback) {
          Demande
            .find(query)
            .limit(limit)
            .sort(sort)
            .skip(offset)
            .exec(waterFallCallback);
        },

        function(demandes, waterFallCallback) {
          duplicates.findDuplicates(demandes, req.etablissement, waterFallCallback);
        },

        function(demandes, duplicates, waterFallCallback) {
          demandes.forEach(function(demande) {
            demande.isDuplicate = duplicates.indexOf(demande.id) > -1;
          });

          waterFallCallback(null, demandes);
        }

      ], function(err, demandes) {
        callback(err, demandes);
      });
    }

  }, function(err, result) {
    if (err) {
      return handleError(req, res, err);
    }

    if (result.demandes) {
      var decoded = decode(result.demandes);
      return res.json(decoded);
    } else {
      return res.json([]);
    }
  });
};

exports.compta = function(req, res) {
  Demande
    .find({etablissement: req.etablissement, status: 'done', 'notification.montant': {$gt: 0}})
    .sort('data.identiteAdulte.demandeur.nom')
    .select('data.identiteAdulte notification')
    .exec(function(err, demandes) {
      if (err) { return handleError(req, res, err); }

      if (demandes && demandes.length > 0) {
        var decoded = decode(demandes);
        return res.json(decoded);
      } else {
        return res.json([]);
      }
    });
};

exports.update = function(req, res) {
  if (req.body._id) { delete req.body._id; }

  var oldEmail = req.etablissement.contact;
  var newEmail = req.body.contact;

  var updated = _.merge(req.etablissement, req.body);
  updated.save(function(err) {
    if (err) { return handleError(req, res, err); }

    if (oldEmail !== newEmail) {
      User.findOne({email: oldEmail}, function(err, found) {
        if (err) {
          return res.status(200).json(req.etablissement);
        }

        found.email = newEmail;
        found.save(function() {
          return res.status(200).json(req.etablissement);
        })
      });
    } else {
      return res.status(200).json(req.etablissement);
    }


  });
};

exports.changePassword = function(req, res) {
  var oldPass = String(req.body.oldPassword);
  var newPass = String(req.body.newPassword);

  return User.findOne({ etablissement: req.etablissement }).select('+salt +hashedPassword').exec()
    .then(user => {
      if (user.authenticate(oldPass) || req.user.role === 'admin') {
        user.password = newPass;
        return user.save()
          .then(() => {
            res.status(204).end();
          })
          .catch(validationError(res));
      } else {
        return res.status(403).end();
      }
    });
};

function handleError(req, res, err) {
  req.log.error(err);
  return res.status(500).send(err);
}
