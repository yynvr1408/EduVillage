from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database.session import get_db
from ..database.models import User, Course, Material
from ..schemas.schemas import MaterialCreate, MaterialOut
from ..services.auth import require_role

router = APIRouter(prefix="/api/materials", tags=["materials"])


@router.get("", response_model=List[MaterialOut])
def list_materials(course_id: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Material).filter(Material.is_published == True)
    if course_id:
        query = query.filter(Material.course_id == course_id)
    return query.all()


@router.post("", response_model=MaterialOut)
def create_material(
    req: MaterialCreate,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    course = db.query(Course).filter(Course.id == req.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    material = Material(
        course_id=req.course_id,
        lesson_id=req.lesson_id,
        title=req.title,
        file_url=req.file_url,
        file_type=req.file_type,
        file_size=req.file_size,
        is_published=True,
    )
    db.add(material)
    db.commit()
    db.refresh(material)
    return material
