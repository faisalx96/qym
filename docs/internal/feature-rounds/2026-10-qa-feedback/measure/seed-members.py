"""QA-A design seed, step 1: 15 members for project access-demo (direct DB insert; the API has no user creation).
usage: seed-members.py DBURL"""
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from qym_platform.db.models import Project, ProjectMembership, ProjectRole, User, UserRole

NAMES = ["Ada Hamdan", "Mona Qahtani", "Sami Otaibi", "Lina Harbi", "Omar Zahrani", "Reem Ghamdi", "Faisal Dossari",
         "Noura Shehri", "Khalid Mutairi", "Huda Subaie", "Yazan Amri", "Dana Rashed", "Tariq Anazi", "Salma Hijazi", "نورة العتيبي"]
e = create_engine(sys.argv[1])
with sessionmaker(bind=e)() as db:
    project = db.query(Project).filter(Project.slug == "access-demo").one()
    for i, name in enumerate(NAMES):
        uid = f"qa-user-{i + 1:02d}"
        if db.get(User, uid):
            continue
        db.add(User(id=uid, email=f"{name.split()[0].lower() if name.isascii() else 'noura.ar'}.{i + 1}@example.com", display_name=name, role=UserRole.MEMBER))
        db.flush()
        db.add(ProjectMembership(project_id=project.id, user_id=uid, role=ProjectRole.MANAGER if i == 1 else ProjectRole.MEMBER))
    db.commit()
    print("members", db.query(ProjectMembership).filter(ProjectMembership.project_id == project.id).count())
